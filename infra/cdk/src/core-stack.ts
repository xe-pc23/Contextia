import { CfnOutput, Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
import type { App, StackProps } from 'aws-cdk-lib';
import { CfnStage, CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  AllowedMethods, CachePolicy, Distribution, HttpVersion, PriceClass, ResponseHeadersPolicy, ViewerProtocolPolicy
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AccountRecovery, OAuthScope, UserPool, UserPoolClientIdentityProvider } from 'aws-cdk-lib/aws-cognito';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LoggingFormat, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseDeploymentConfig } from '@contextia/config';
import type { DeploymentConfig } from '@contextia/config';

export type CoreStackOptions = {
  /** Built Scenario Console (`apps/web/dist`). */
  webAssetPath: string;
};

/** Browser origins allowed to call the dev API and Cognito callbacks during local development. */
const DEV_LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const WEB_SCOPES = ['openid', 'email'];

export class ContextiaCoreStack extends Stack {
  constructor(scope: App, config: DeploymentConfig, options: CoreStackOptions, props: StackProps = {}) {
    const target = parseDeploymentConfig(config);
    const prefix = `contextia-${target.stage}`;
    super(scope, `${prefix}-core`, {
      ...props,
      stackName: `${prefix}-core`,
      env: { account: target.account, region: target.region }
    });
    const isDev = target.stage === 'dev';
    const removalPolicy = isDev ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN;

    const table = new Table(this, 'DataTable', {
      tableName: `${prefix}-data`,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: !isDev },
      deletionProtection: !isDev,
      removalPolicy
    });

    const webBucket = new Bucket(this, 'WebBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: isDev
    });
    const distribution = new Distribution(this, 'WebDistribution', {
      comment: `${prefix}-web`,
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2_AND_3,
      priceClass: PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true
      },
      // SPA fallback: the private bucket answers 403 for unknown keys.
      errorResponses: [403, 404].map(httpStatus => ({ httpStatus, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) }))
    });
    const webOrigin = `https://${distribution.distributionDomainName}`;
    const browserOrigins = [webOrigin, ...(isDev ? DEV_LOCAL_ORIGINS : [])];

    const userPool = new UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: false },
      deletionProtection: !isDev,
      removalPolicy
    });
    const hostedUi = userPool.addDomain('HostedUiDomain', { cognitoDomain: { domainPrefix: `${prefix}-${target.account}` } });
    const webClient = userPool.addClient('WebClient', {
      userPoolClientName: `${prefix}-web`,
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL],
        callbackUrls: browserOrigins.map(origin => `${origin}/`),
        logoutUrls: browserOrigins.map(origin => `${origin}/`)
      }
    });
    const mobileRedirect = `contextia-${target.stage}://auth/callback`;
    const mobileClient = userPool.addClient('MobileClient', {
      userPoolClientName: `${prefix}-mobile`,
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL],
        callbackUrls: [mobileRedirect],
        logoutUrls: [mobileRedirect]
      }
    });

    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const logs = new LogGroup(this, 'ApiLogs', {
      logGroupName: `/aws/lambda/${prefix}-api`,
      retention: isDev ? RetentionDays.ONE_WEEK : RetentionDays.ONE_MONTH,
      removalPolicy
    });
    const apiRole = new Role(this, 'ApiRole', {
      roleName: `${prefix}-api-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com')
    });
    logs.grantWrite(apiRole);
    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      functionName: `${prefix}-api`,
      entry: join(root, 'apps/api/src/handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      role: apiRole,
      timeout: Duration.seconds(20),
      memorySize: 256,
      logGroup: logs,
      loggingFormat: LoggingFormat.JSON,
      environment: {
        CONTEXTIA_STAGE: target.stage,
        BUILD_ID: target.buildId,
        WEB_CLIENT_ID: webClient.userPoolClientId,
        MOBILE_CLIENT_ID: mobileClient.userPoolClientId
      },
      depsLockFilePath: join(root, 'pnpm-lock.yaml'),
      projectRoot: root,
      bundling: { target: 'node24', format: OutputFormat.CJS, externalModules: [], sourceMap: true }
    });

    const api = new HttpApi(this, 'HttpApi', {
      apiName: `${prefix}-http-api`,
      corsPreflight: {
        allowOrigins: browserOrigins,
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ['authorization', 'content-type', 'accept'],
        maxAge: Duration.hours(1)
      }
    });
    const integration = new HttpLambdaIntegration('ApiIntegration', apiFunction);
    const authorizer = new HttpJwtAuthorizer('CognitoAuthorizer', `https://cognito-idp.${target.region}.amazonaws.com/${userPool.userPoolId}`, {
      authorizerName: `${prefix}-cognito`,
      jwtAudience: [webClient.userPoolClientId, mobileClient.userPoolClientId]
    });
    api.addRoutes({ path: '/health', methods: [HttpMethod.GET], integration });
    api.addRoutes({ path: '/v1/context/evaluate', methods: [HttpMethod.POST], integration, authorizer });
    const defaultStage = api.defaultStage?.node.defaultChild;
    if (defaultStage instanceof CfnStage) {
      defaultStage.defaultRouteSettings = { throttlingBurstLimit: 20, throttlingRateLimit: 10 };
    }

    // Hashed assets are immutable; the entry point and runtime config must never be cached long.
    const assets = new BucketDeployment(this, 'WebAssets', {
      sources: [Source.asset(options.webAssetPath, { exclude: ['index.html', 'config.json'] })],
      destinationBucket: webBucket,
      prune: false,
      cacheControl: [CacheControl.fromString('public, max-age=31536000, immutable')],
      memoryLimit: 512
    });
    const entry = new BucketDeployment(this, 'WebEntry', {
      sources: [
        Source.asset(options.webAssetPath, { exclude: ['*', '!index.html'] }),
        Source.jsonData('config.json', {
          stage: target.stage,
          apiBaseUrl: api.apiEndpoint,
          auth: { cognitoDomain: hostedUi.baseUrl(), clientId: webClient.userPoolClientId, redirectUri: `${webOrigin}/`, scopes: WEB_SCOPES },
          map: null
        })
      ],
      destinationBucket: webBucket,
      prune: false,
      cacheControl: [CacheControl.noCache()],
      distribution,
      distributionPaths: ['/', '/index.html', '/config.json']
    });
    entry.node.addDependency(assets);

    new CfnOutput(this, 'Stage', { value: target.stage });
    new CfnOutput(this, 'ApiBaseUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'WebUrl', { value: `${webOrigin}/` });
    new CfnOutput(this, 'WebBucketName', { value: webBucket.bucketName });
    new CfnOutput(this, 'WebDistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'WebClientId', { value: webClient.userPoolClientId });
    new CfnOutput(this, 'MobileClientId', { value: mobileClient.userPoolClientId });
    new CfnOutput(this, 'HostedUiBaseUrl', { value: hostedUi.baseUrl() });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    Tags.of(this).add('project', 'contextia');
    Tags.of(this).add('stage', target.stage);
  }
}

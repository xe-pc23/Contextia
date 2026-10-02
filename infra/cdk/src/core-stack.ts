import { CfnOutput, CfnParameter, DefaultStackSynthesizer, Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
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
import { FederatedPrincipal, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnAPIKey } from 'aws-cdk-lib/aws-location';
import { CfnLayerVersion, LoggingFormat, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { AwsCustomResource, AwsCustomResourcePolicy, Logging, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
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
      env: { account: target.account, region: target.region },
      synthesizer: props.synthesizer ?? new DefaultStackSynthesizer({ qualifier: target.stage === 'dev' ? 'ctiadev' : 'ctiaprod' })
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

    // Model IDs and permission resources are deploy-time parameters, never repository constants.
    const modelId = new CfnParameter(this, 'BedrockModelId', { type: 'String', minLength: 1, description: 'Enabled Bedrock model or inference profile ID.' });
    const modelRegion = new CfnParameter(this, 'BedrockRegion', { type: 'String', default: target.region, allowedPattern: '[a-z]{2}(-gov)?-[a-z]+-[0-9]+' });
    const modelResources = new CfnParameter(this, 'BedrockModelResources', {
      type: 'CommaDelimitedList', allowedPattern: 'arn:aws:bedrock:[a-z0-9-]+:[0-9]*:(foundation-model|inference-profile|application-inference-profile)/[A-Za-z0-9._:/-]+',
      description: 'Exact model/inference-profile ARNs, including destination models for cross-region profiles; no wildcards.'
    });
    const mapKeyExpiry = new CfnParameter(this, 'MapKeyExpireTime', {
      type: 'String', allowedPattern: '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z',
      description: 'Future UTC expiration for the public, map-only browser API key. Rotate before expiry.'
    });
    const mapKey = new CfnAPIKey(this, 'BrowserMapKey', {
      keyName: `${prefix}-web-map`, expireTime: mapKeyExpiry.valueAsString, noExpiry: false, forceUpdate: true,
      restrictions: { allowActions: ['geo-maps:GetTile'],
        allowResources: [`arn:${this.partition}:geo-maps:${target.region}::provider/default`],
        allowReferers: browserOrigins.map(origin => `${origin}/*`) }
    });
    // Avoid force-deleting an in-use key on teardown; owner may remove it after expiry.
    mapKey.applyRemovalPolicy(RemovalPolicy.RETAIN);
    const mapKeyValue = new AwsCustomResource(this, 'BrowserMapKeyValue', {
      onUpdate: { service: 'Location', action: 'describeKey', parameters: { KeyName: mapKey.ref },
        physicalResourceId: PhysicalResourceId.of(`${prefix}-web-map-value`), outputPaths: ['Key'], logging: Logging.withDataHidden() },
      installLatestAwsSdk: false, timeout: Duration.seconds(30),
      logGroup: new LogGroup(this, 'MapKeyReaderLogs', { logGroupName: `/aws/contextia/${target.stage}/map-key-reader`, retention: isDev ? RetentionDays.ONE_WEEK : RetentionDays.ONE_MONTH, removalPolicy }),
      policy: AwsCustomResourcePolicy.fromStatements([new PolicyStatement({ actions: ['geo:DescribeKey'], resources: [mapKey.attrArn] })])
    });
    mapKeyValue.node.addDependency(mapKey);

    // The owner bootstraps the GitHub OIDC provider and stage-specific CDK roles first.
    const oidcProvider = `arn:${this.partition}:iam::${target.account}:oidc-provider/token.actions.githubusercontent.com`;
    // GitHub's immutable subject prefix, verified through the repository OIDC settings.
    const repositorySubject = 'repo:xe-pc23@208585459/Contextia@1395735696';
    const deployRole = new Role(this, 'GitHubDeployRole', {
      roleName: isDev ? 'GitHubDevDeployRole' : 'GitHubProdDeployRole',
      assumedBy: new FederatedPrincipal(oidcProvider, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `${repositorySubject}:environment:${target.stage}` }
      }, 'sts:AssumeRoleWithWebIdentity')
    });
    const qualifier = isDev ? 'ctiadev' : 'ctiaprod';
    deployRole.addToPolicy(new PolicyStatement({ actions: ['sts:AssumeRole'],
      resources: ['deploy', 'file-publishing'].map(kind => `arn:${this.partition}:iam::${target.account}:role/cdk-${qualifier}-${kind}-role-${target.account}-${target.region}`) }));
    deployRole.addToPolicy(new PolicyStatement({ actions: ['cloudformation:DescribeStacks'],
      resources: [`arn:${this.partition}:cloudformation:${target.region}:${target.account}:stack/${prefix}-core/*`] }));
    if (isDev) deployRole.addToPolicy(new PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [table.tableArn] }));

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
      authFlows: { userSrp: true, userPassword: isDev },
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
    apiRole.addToPolicy(new PolicyStatement({ actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:ConditionCheckItem'], resources: [table.tableArn] }));
    apiRole.addToPolicy(new PolicyStatement({ actions: ['geo-places:SearchNearby', 'geo-places:GetPlace', 'geo-places:Geocode'], resources: [`arn:${this.partition}:geo-places:${target.region}::provider/default`] }));
    apiRole.addToPolicy(new PolicyStatement({ actions: ['geo-routes:CalculateRoutes'], resources: [`arn:${this.partition}:geo-routes:${target.region}::provider/default`] }));
    apiRole.addToPolicy(new PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: modelResources.valueAsList }));
    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      functionName: `${prefix}-api`,
      entry: join(root, 'apps/api/src/runtime.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      role: apiRole,
      timeout: Duration.seconds(20),
      memorySize: 512,
      logGroup: logs,
      loggingFormat: LoggingFormat.JSON,
      environment: {
        CONTEXTIA_STAGE: target.stage,
        BUILD_ID: target.buildId,
        WEB_CLIENT_ID: webClient.userPoolClientId,
        MOBILE_CLIENT_ID: mobileClient.userPoolClientId,
        TABLE_NAME: table.tableName,
        BEDROCK_MODEL_ID: modelId.valueAsString,
        BEDROCK_REGION: modelRegion.valueAsString,
        BEDROCK_STRUCTURED_OUTPUT: 'true',
        WEATHER_ENDPOINT: 'https://api.open-meteo.com/v1/forecast',
        STATE_TIMEOUT_MS: '1500', PLACES_TIMEOUT_MS: '2500', WEATHER_TIMEOUT_MS: '2000', ROUTES_TIMEOUT_MS: '3000', MODEL_TIMEOUT_MS: '7000',
        ENRICHMENT_TIMEOUT_MS: '7000', EVALUATION_TIMEOUT_MS: '17000', MAX_ROUTE_PLACES: '6', ROUTE_CONCURRENCY: '4', EVENT_ROUTE_MODE: 'transit',
        CONTEXT_TTL_SECONDS: '86400', RECOMMENDATION_TTL_SECONDS: '604800', CONVERSATION_TTL_SECONDS: '7200', IDEMPOTENCY_TTL_SECONDS: '3600'
      },
      depsLockFilePath: join(root, 'pnpm-lock.yaml'),
      projectRoot: root,
      bundling: { target: 'node24', format: OutputFormat.CJS, externalModules: [], sourceMap: true }
    });

    const api = new HttpApi(this, 'HttpApi', {
      apiName: `${prefix}-http-api`,
      corsPreflight: {
        allowOrigins: browserOrigins,
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.PUT, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ['authorization', 'content-type', 'accept', 'idempotency-key'],
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
    for (const [path, method] of [
      ['/v1/me', HttpMethod.GET], ['/v1/me/preferences', HttpMethod.PUT], ['/v1/recommendations', HttpMethod.GET],
      ['/v1/recommendations/{recommendationId}', HttpMethod.GET], ['/v1/recommendations/{recommendationId}/chat', HttpMethod.POST]
    ] as const) api.addRoutes({ path, methods: [method], integration, authorizer });
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
          buildId: target.buildId,
          apiBaseUrl: api.apiEndpoint,
          auth: { cognitoDomain: hostedUi.baseUrl(), clientId: webClient.userPoolClientId, redirectUri: `${webOrigin}/`, scopes: WEB_SCOPES },
          map: { region: target.region, styleName: 'Standard', apiKey: mapKeyValue.getResponseField('Key') }
        })
      ],
      destinationBucket: webBucket,
      prune: false,
      cacheControl: [CacheControl.noCache()],
      distribution,
      distributionPaths: ['/', '/index.html', '/config.json']
    });
    // BucketDeployment's layers otherwise use only the logical ID as their names.
    // Name both helpers so the stage-scoped CloudFormation role can manage them.
    for (const [deployment, name] of [[assets, 'assets'], [entry, 'entry']] as const) {
      const layer = deployment.node.findChild('AwsCliLayer').node.defaultChild;
      if (!(layer instanceof CfnLayerVersion)) throw new Error('BucketDeployment AWS CLI layer is missing');
      layer.layerName = `${prefix}-core-web-${name}-aws-cli`;
    }
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

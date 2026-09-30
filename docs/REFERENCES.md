# REFERENCES.md — Verified Technical References

Verified on 2026-09-30. Prefer these official sources when implementation questions arise.

## Hackathon

- Zero to Shipped rules / Ship Gate  
  https://builder.aws.com/build/hackathons/e83e84e5-4f4c-383b-bbe9-4a15ac195d55/zero-to-shipped?tab=rules

Key verified requirements:
- application live on AWS,
- reachable via public URL,
- coding-agent connection proof,
- accessible to AI scoring and human judges.

## AWS Agent Toolkit / MCP

- Agent Toolkit overview  
  https://docs.aws.amazon.com/agent-toolkit/latest/userguide/what-is-agent-toolkit.html
- AWS MCP Server  
  https://docs.aws.amazon.com/agent-toolkit/latest/userguide/mcp-server.html
- OAuth configuration (Codex / Claude Code examples)  
  https://docs.aws.amazon.com/agent-toolkit/latest/userguide/oauth-authentication.html
- CloudTrail logging  
  https://docs.aws.amazon.com/agent-toolkit/latest/userguide/logging-using-cloudtrail.html

## API Gateway / Cognito

- HTTP API JWT authorizer  
  https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html

## Lambda / TypeScript

- Lambda Node.js runtimes  
  https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html
- TypeScript on Lambda  
  https://docs.aws.amazon.com/lambda/latest/dg/lambda-typescript.html
- CDK NodejsFunction  
  https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs-readme.html

## Amazon Location

- Places V2 SearchNearby  
  https://docs.aws.amazon.com/location/latest/APIReference/API_geoplaces_SearchNearby.html
- Places V2 Geocode  
  https://docs.aws.amazon.com/location/latest/APIReference/API_geoplaces_Geocode.html
- Places V2 GetPlace  
  https://docs.aws.amazon.com/location/latest/APIReference/API_geoplaces_GetPlace.html
- Places IntendedUse  
  https://docs.aws.amazon.com/location/latest/developerguide/places-intended-use.html
- Routes overview  
  https://docs.aws.amazon.com/location/latest/developerguide/routes.html
- Transit routing  
  https://docs.aws.amazon.com/location/latest/developerguide/transit-routing.html
- Intermodal routing  
  https://docs.aws.amazon.com/location/latest/developerguide/intermodal-routing.html
- MapLibre with Amazon Location  
  https://docs.aws.amazon.com/location/latest/developerguide/dev-maplibre.html
- API key authentication / restrictions  
  https://docs.aws.amazon.com/location/latest/developerguide/using-apikeys.html

Important SearchNearby detail:
- persistent search results require `IntendedUse=Storage`.
- default/transient is `SingleUse`.

## Bedrock

- Structured Outputs  
  https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html
- Converse / tool use  
  https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use.html

## DynamoDB

- TTL  
  https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html
- TTL computation  
  https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/time-to-live-ttl-before-you-start.html

Important:
TTL expiration does not mean physical deletion occurs exactly at that instant.

## CloudFront / S3

- Restrict S3 origin using OAC  
  https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html

AWS recommends OAC over legacy OAI.

## Expo

- Location  
  https://docs.expo.dev/versions/latest/sdk/location/
- Calendar  
  https://docs.expo.dev/versions/latest/sdk/calendar/
- Pedometer  
  https://docs.expo.dev/versions/latest/sdk/pedometer/
- Sensors  
  https://docs.expo.dev/versions/latest/sdk/sensors/
- Notifications  
  https://docs.expo.dev/versions/latest/sdk/notifications/

Important:
- background location needs appropriate permissions/development build.
- current Calendar package requires development build.
- Pedometer `getStepCountAsync(start,end)` is iOS-only.
- Pedometer subscription updates are not delivered in background.

## Android Health Connect

- Read Health Connect data / steps  
  https://developer.android.com/health-and-fitness/health-connect/read-data
- Steps  
  https://developer.android.com/health-and-fitness/health-connect/features/steps
- Complete integration/background read example  
  https://developer.android.com/codelabs/health-connect

Current Android guidance supports aggregated/background step reads with appropriate platform support and permissions.

## GitHub Actions / AWS OIDC

- GitHub OIDC in AWS  
  https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws

Implementation must prefer short-lived assumed-role credentials over stored AWS access keys.

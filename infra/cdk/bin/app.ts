import { EXPECTED_AWS_ACCOUNT, EXPECTED_AWS_REGION } from '@contextia/config';
import { createContextiaApp } from '../src/app.js';

const app = createContextiaApp({
  account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? EXPECTED_AWS_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? EXPECTED_AWS_REGION,
  buildId: process.env.BUILD_ID
});
app.synth();

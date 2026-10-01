import { App } from 'aws-cdk-lib';
import { parseDeploymentConfig } from '@contextia/config';
import { ContextiaCoreStack } from './core-stack.js';

export type AppOptions = { stage?: unknown; account?: unknown; region?: unknown; buildId?: unknown; outdir?: string };

export function createContextiaApp(options: AppOptions): App {
  const app = new App({ autoSynth: false, ...(options.outdir ? { outdir: options.outdir } : {}) });
  const config = parseDeploymentConfig({
    stage: options.stage ?? app.node.tryGetContext('stage'),
    account: options.account,
    region: options.region,
    buildId: options.buildId
  });
  new ContextiaCoreStack(app, config);
  return app;
}

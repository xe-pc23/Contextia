import { App } from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeploymentConfig } from '@contextia/config';
import { ContextiaCoreStack } from './core-stack.js';

export type AppOptions = {
  stage?: unknown; account?: unknown; region?: unknown; buildId?: unknown; outdir?: string;
  /** Defaults to the built Scenario Console in `apps/web/dist`. */
  webAssetPath?: string;
};

export const DEFAULT_WEB_ASSET_PATH = fileURLToPath(new URL('../../../apps/web/dist', import.meta.url));

export function createContextiaApp(options: AppOptions): App {
  const app = new App({ autoSynth: false, ...(options.outdir ? { outdir: options.outdir } : {}) });
  const config = parseDeploymentConfig({
    stage: options.stage ?? app.node.tryGetContext('stage'),
    account: options.account,
    region: options.region,
    buildId: options.buildId
  });
  const webAssetPath = options.webAssetPath ?? DEFAULT_WEB_ASSET_PATH;
  if (!existsSync(join(webAssetPath, 'index.html'))) {
    throw new Error('Scenario Console build not found. Run `pnpm build` before CDK synth.');
  }
  new ContextiaCoreStack(app, config, { webAssetPath });
  return app;
}

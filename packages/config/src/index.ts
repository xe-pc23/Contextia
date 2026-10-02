import { z } from 'zod';

// Approved deployment boundary; changing it requires an environment decision.
export const EXPECTED_AWS_ACCOUNT = '634512763705';
export const EXPECTED_AWS_REGION = 'ap-northeast-1';

export const DeploymentConfigSchema = z.strictObject({
  stage: z.enum(['dev', 'prod']),
  account: z.literal(EXPECTED_AWS_ACCOUNT),
  region: z.literal(EXPECTED_AWS_REGION),
  buildId: z.string().trim().min(1).max(128).default('development')
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

export function parseDeploymentConfig(input: unknown): DeploymentConfig {
  return DeploymentConfigSchema.parse(input);
}

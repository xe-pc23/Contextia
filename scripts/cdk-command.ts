export type CdkInvocation = { action: 'synth' | 'diff' | 'deploy'; stage: 'dev' | 'prod' };

export function parseCdkInvocations(argv: readonly string[]): CdkInvocation[] {
  if (argv.length === 1 && argv[0] === 'synth') {
    return [{ action: 'synth', stage: 'dev' }, { action: 'synth', stage: 'prod' }];
  }
  if (argv.length === 2 && (argv[0] === 'diff' || argv[0] === 'deploy') && (argv[1] === 'dev' || argv[1] === 'prod')) {
    return [{ action: argv[0], stage: argv[1] }];
  }
  throw new Error('Use an explicit dev/prod stage for diff/deploy, or synth for both stages.');
}

export function cdkArgs(invocation: CdkInvocation, outdir: string): string[] {
  return [
    '--filter', '@contextia/infra', 'exec', 'cdk', invocation.action, `contextia-${invocation.stage}-core`,
    '--context', `stage=${invocation.stage}`, '--output', outdir, '--no-lookups',
    ...(invocation.action === 'diff' ? ['--exclusively', '--method=template'] : invocation.action === 'deploy'
      ? ['--exclusively', '--require-approval', 'never', '--change-set-name', `contextia-${invocation.stage}-core-deploy`, '--outputs-file', `${outdir}/outputs.json`] : ['--quiet'])
  ];
}

export function deploymentParameters(env: Record<string, string | undefined>): string[] {
  const parameters = {
    BedrockModelId: env.BEDROCK_MODEL_ID, BedrockRegion: env.BEDROCK_REGION?.trim() || 'ap-northeast-1',
    BedrockStructuredOutput: env.BEDROCK_STRUCTURED_OUTPUT?.trim() || 'true',
    BedrockModelResources: env.BEDROCK_MODEL_RESOURCES, MapKeyExpireTime: env.MAP_KEY_EXPIRE_TIME
  };
  if (Object.values(parameters).some(value => !value?.trim())) throw new Error('Missing deployment parameters');
  if (!['true', 'false'].includes(parameters.BedrockStructuredOutput)) throw new Error('Invalid structured-output capability');
  if (parameters.BedrockModelResources?.split(',').some(arn => !/^arn:aws:bedrock:[a-z0-9-]+:[0-9]*:(foundation-model|inference-profile|application-inference-profile)\/[A-Za-z0-9._:/-]+$/.test(arn.trim()))) throw new Error('Model resources must be exact ARNs');
  const expiry = Date.parse(parameters.MapKeyExpireTime ?? '');
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Map key expiry must be in the future');
  return Object.entries(parameters).flatMap(([name, value]) => ['--parameters', `${name}=${value}`]);
}

export function requireProductionMain(env: Record<string, string | undefined>, branch: string): void {
  if (env.GITHUB_ACTIONS === 'true') {
    if (env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('Production requires a manual main workflow');
  } else if (branch !== 'main') throw new Error('Production requires the main branch');
}

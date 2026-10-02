export type CdkInvocation = { action: 'synth'; stage: 'dev' | 'prod' } | { action: 'diff'; stage: 'dev' };

export function parseCdkInvocations(argv: readonly string[]): CdkInvocation[] {
  if (argv.length === 1 && argv[0] === 'synth') {
    return [{ action: 'synth', stage: 'dev' }, { action: 'synth', stage: 'prod' }];
  }
  if (argv.length === 2 && argv[0] === 'diff' && argv[1] === 'dev') {
    return [{ action: 'diff', stage: 'dev' }];
  }
  throw new Error('Use cdk:synth or cdk:diff:dev. Production diff/deploy belongs to the project owner.');
}

export function cdkArgs(invocation: CdkInvocation, outdir: string): string[] {
  return [
    '--filter', '@contextia/infra', 'exec', 'cdk', invocation.action, `contextia-${invocation.stage}-core`,
    '--context', `stage=${invocation.stage}`, '--output', outdir, '--no-lookups',
    ...(invocation.action === 'diff' ? ['--exclusively', '--method=template'] : ['--quiet'])
  ];
}

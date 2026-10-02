import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

describe('Scenario Console production bundle', () => {
  it('excludes test fixture modules and synthetic provider responses', async () => {
    const result = await build({
      root: fileURLToPath(new URL('../', import.meta.url)),
      logLevel: 'silent',
      build: { write: false }
    });
    const results = Array.isArray(result) ? result : [result];
    const chunks = results.flatMap(output => 'output' in output ? output.output : []).filter(output => output.type === 'chunk');
    expect(chunks.length).toBeGreaterThan(0);
    const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
    expect(modules.filter(id => id.includes('/packages/test-fixtures/'))).toEqual([]);
    const code = chunks.map(chunk => chunk.code).join('\n');
    expect(code).not.toContain('Synthetic test cafe');
    expect(code).not.toContain('synthetic-route-1');
    expect(code).not.toContain('synthetic-station-1');
  });
});

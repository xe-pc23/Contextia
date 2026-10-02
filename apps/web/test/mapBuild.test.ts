import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { build } from 'vite';

it('deploys a resolvable module worker with the production MapLibre chunk', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'contextia-map-build-'));
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'silent', build: { outDir: directory } });
    const assets = await readdir(join(directory, 'assets'));
    const map = assets.find(name => /^maplibre-gl-[\w-]+\.js$/.test(name) && !name.startsWith('maplibre-gl-worker-'));
    expect(map).toBeDefined();
    const code = (await Promise.all(assets.filter(name => name.endsWith('.js')).map(name => readFile(join(directory, 'assets', name), 'utf8')))).join('\n');
    const worker = /\/assets\/(maplibre-gl-worker-[\w-]+\.js)/.exec(code)?.[1];
    expect(worker).toBeDefined();
    expect(assets).toContain(worker);
    const workerCode = await readFile(join(directory, 'assets', worker!), 'utf8');
    expect(workerCode.length).toBeGreaterThan(1000);
    expect(workerCode).not.toContain('maplibre-gl-shared.mjs');
    for (const match of workerCode.matchAll(/from["']\.\/([^"']+)["']/g)) expect(assets).toContain(match[1]);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 20_000);

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { expect, it } from 'vitest';

it('施設データだけの更新ではJSONのURLだけが変わり、JSのURLと内容は変わらない', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const audit = path.join(root, '.audit');
  await fs.mkdir(audit, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(audit, 'assets-test-'));
  try {
    await fs.cp(path.join(root, 'src'), path.join(fixture, 'src'), { recursive: true });
    await fs.cp(path.join(root, 'data/map'), path.join(fixture, 'data/map'), { recursive: true });
    await fs.copyFile(path.join(root, 'index.html'), path.join(fixture, 'index.html'));
    const compile = async () => {
      await build({
        root: fixture,
        configFile: false,
        plugins: [react()],
        build: { outDir: 'dist/client' },
        logLevel: 'silent',
      });
      const html = await fs.readFile(path.join(fixture, 'dist/client/index.html'), 'utf8');
      const js = html.match(/src="([^" ]+\.js)"/)![1];
      const json = html.match(/id="facilities-data"[^>]*href="([^" ]+)"/)![1];
      expect(json).toMatch(/^\/assets\/facilities-.*\.json$/);
      return { js, json, bytes: await fs.readFile(path.join(fixture, 'dist/client', js)) };
    };
    const before = await compile();
    const dataPath = path.join(fixture, 'src/data/facilities.json');
    const data = await fs.readFile(dataPath, 'utf8');
    await fs.writeFile(dataPath, data.replace('大阪', '大坂'));
    const after = await compile();
    expect(after.json).not.toBe(before.json);
    expect(after.js).toBe(before.js);
    expect(after.bytes).toEqual(before.bytes);
  } finally {
    if (path.dirname(fixture) === audit) await fs.rm(fixture, { recursive: true, force: true });
  }
}, 30_000);

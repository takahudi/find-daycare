import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };
import { writeJson } from './json.ts';
import { createManifest, fetchSnapshot, fetchSnapshots, manifestBytes, sha256, stageManifest } from './snapshots.ts';
import type { SnapshotStorage } from './snapshot-storage.ts';

let root: string;
let sources: string;
let data: string;
const date = '2026-10-22';
const wardFiles = ['list.xlsx', 'vacancy_page.html', 'kigyo_page.html', 'facility-pdfs/1.pdf'];
const cityFiles = ['sukusukudata.csv', 'ninkagai_detail.pdf'];
const chuoFiles = [...wardFiles, 'vacancy.pdf'];

async function download(dir: string, files = chuoFiles) {
  for (const file of files) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), 'download');
  }
}
beforeEach(async () => {
  await mkdir(path.resolve('.audit'), { recursive: true });
  root = await mkdtemp(path.resolve('.audit/snapshot-fetch-'));
  sources = path.join(root, 'sources');
  data = path.join(root, 'data');
  await mkdir(path.join(sources, 'chuo'), { recursive: true });
  await mkdir(path.join(data, 'chuo'), { recursive: true });
  await writeFile(path.join(sources, 'chuo', 'old'), 'keep');
  await writeJson(
    'snapshot.json',
    path.join(data, 'chuo', 'snapshot.json'),
    await createManifest(path.join(sources, 'chuo'), date),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const options = () => ({ sources, data, fetchedOn: '2026-10-23', log: vi.fn<(line: string) => void>() });

it.each([false, true])('cityは同じJSTの日を省略し、forceCityだけ再取得する（force=%s）', async (forceCity) => {
  const dir = path.join(sources, 'city');
  await mkdir(path.join(data, 'city'), { recursive: true });
  await download(dir, cityFiles);
  const manifest = await createManifest(dir, date);
  await writeJson('snapshot.json', path.join(data, 'city', 'snapshot.json'), manifest);
  const get = vi.fn(async (temporary: string) => download(temporary, cityFiles));
  const head = vi.fn(async () => ({ sha256: sha256(manifestBytes(manifest)) }));
  const storage: SnapshotStorage = { head, put: async () => 'created', get: async () => Buffer.alloc(0) };
  await fetchSnapshot('city', get, { ...options(), fetchedOn: date, forceCity, storage });
  expect(get).toHaveBeenCalledTimes(forceCity ? 1 : 0);
  expect(head).toHaveBeenCalledTimes(forceCity ? 1 : 0);
});

const cases = [
  { id: 'chuo', files: chuoFiles },
  { id: 'nishi', files: wardFiles },
  { id: 'kita', files: [...wardFiles, 'vacancy.xlsx', 'kigyo.xlsx'] },
  { id: 'ikuno', files: [...wardFiles, 'vacancy.pdf', 'kigyo.pdf'] },
  { id: 'abeno', files: [...wardFiles, 'kigyo_info.pdf'] },
  { id: 'naniwa', files: [...wardFiles, 'vacancy.pdf', 'kigyo_info_page.html'] },
  { id: 'city', files: cityFiles },
];
it.each(cases)('各区の必要ファイルが欠けた取得は旧一式を置換しない（$id）', async ({ id, files }) => {
  const old = path.join(sources, id);
  await mkdir(old, { recursive: true });
  await writeFile(path.join(old, 'sentinel'), 'keep');
  for (const missing of files) {
    let kept = '';
    const result = fetchSnapshot(
      id,
      async (dir) => {
        kept = dir;
        await download(
          dir,
          files.filter((file) => file !== missing),
        );
      },
      { ...options(), discardUnarchived: [id] },
    );
    await expect(result).rejects.toThrow('ビルドに必要');
    await expect(result).rejects.toThrow(kept);
    expect(await readFile(path.join(old, 'sentinel'), 'utf8')).toBe('keep');
  }
  await fetchSnapshot(id, async (dir) => download(dir, files), { ...options(), discardUnarchived: [id] });
  expect(await readdir(old)).not.toContain('sentinel');
});

it.each(['missing', 'changed'])('検証コマンドは復元方法を案内し、抽出処理より先に失敗する（%s）', async (mode) => {
  if (mode === 'missing') await rm(path.join(sources, 'chuo'), { recursive: true });
  else await writeFile(path.join(sources, 'chuo', 'old'), 'changed');
  const verify = path.resolve('scripts/data-verify.ts').replaceAll('\\', '/');
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  for (const file of ['extract-pdf-details.ts', 'extract-kigyo-details.ts', 'build-data.ts']) {
    await writeFile(
      path.join(root, 'scripts', file),
      "import { writeFileSync } from 'node:fs'; writeFileSync('extracted', 'unexpected');",
    );
  }
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      type: 'module',
      scripts: {
        'data:build': packageJson.scripts['data:build'],
        'data:verify': `node "${verify}" chuo`,
      },
    }),
  );
  const run = spawnSync('pnpm --ignore-scripts data:build', { cwd: root, encoding: 'utf8', shell: true });
  expect(run.status).not.toBe(0);
  const output = run.stdout + run.stderr;
  expect(output).toContain('pnpm data:restore');
  expect(output).not.toContain('ENOENT');
  expect(await readdir(root)).not.toContain('extracted');
});

it('中断で残る一時manifestをGitが追跡対象にしない', async () => {
  const snapshot = await createManifest(path.join(sources, 'chuo'), date);
  const staged = await stageManifest('chuo', snapshot, data);
  expect((await readdir(path.join(data, 'chuo'))).some((name) => /^\.snapshot-.*\.json$/.test(name))).toBe(true);
  const ignored = execFileSync('git', ['check-ignore', '--no-index', 'data/chuo/.snapshot-interrupted.json'], {
    encoding: 'utf8',
  });
  expect(ignored.trim()).toBe('data/chuo/.snapshot-interrupted.json');
  await staged.cleanup();
  expect(await readdir(path.join(data, 'chuo'))).toEqual(['snapshot.json']);
});

it.each(['missing', 'changed', 'yesterday'])('cityは本日の検証済みツリー以外を再取得する（%s）', async (mode) => {
  const dir = path.join(sources, 'city');
  await download(dir, cityFiles);
  await mkdir(path.join(data, 'city'), { recursive: true });
  await writeJson(
    'snapshot.json',
    path.join(data, 'city', 'snapshot.json'),
    await createManifest(dir, mode === 'yesterday' ? '2026-10-21' : date),
  );
  if (mode === 'missing') await rm(dir, { recursive: true });
  if (mode === 'changed') await writeFile(path.join(dir, cityFiles[0]), 'unarchived');
  const get = vi.fn(async (temporary: string) => download(temporary, cityFiles));
  await fetchSnapshot('city', get, { ...options(), fetchedOn: date, discardUnarchived: ['city'] });
  expect(get).toHaveBeenCalledOnce();
  expect(await readFile(path.join(dir, cityFiles[0]), 'utf8')).toBe('download');
});

it.each(['city', 'chuo'])('後続の%sが拒否される場合は全対象を取得しない', async (blocked) => {
  const good = blocked === 'city' ? 'nishi' : 'city';
  await mkdir(path.join(sources, blocked), { recursive: true });
  await writeFile(path.join(sources, blocked, 'sentinel'), 'keep');
  const get = vi.fn(async () => {});
  await expect(fetchSnapshots([good, blocked], get, options())).rejects.toThrow(blocked);
  expect(get).not.toHaveBeenCalled();
  expect(await readFile(path.join(sources, blocked, 'sentinel'), 'utf8')).toBe('keep');
});

it('cityの当日manifestと異なるツリーを削除許可なしでは取得前に拒否する', async () => {
  const dir = path.join(sources, 'city');
  await download(dir, cityFiles);
  await mkdir(path.join(data, 'city'), { recursive: true });
  await writeJson('snapshot.json', path.join(data, 'city', 'snapshot.json'), await createManifest(dir, date));
  await writeFile(path.join(dir, cityFiles[0]), 'unarchived');
  const get = vi.fn(async () => {});
  await expect(fetchSnapshot('city', get, { ...options(), fetchedOn: date })).rejects.toThrow('異なります');
  expect(get).not.toHaveBeenCalled();
  expect(await readFile(path.join(dir, cityFiles[0]), 'utf8')).toBe('unarchived');
});

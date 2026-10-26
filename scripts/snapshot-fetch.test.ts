import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };
import { writeJson } from './json.ts';
import { createManifest, fetchSnapshot, loadVerifiedSnapshots, manifestBytes, sha256, stageManifest } from './snapshots.ts';
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

it.each(['no credentials', 'absent', 'different', 'same'])('保管確認に応じて旧一式を保持する（%s）', async (mode) => {
  const before = await readFile(path.join(data, 'chuo', 'snapshot.json'));
  const head = vi.fn(async () => (mode === 'absent' ? null : { sha256: mode === 'same' ? sha256(before) : 'different' }));
  const storage: SnapshotStorage = {
    head,
    put: async () => {
      throw new Error('unused');
    },
    get: async () => {
      throw new Error('unused');
    },
  };
  const opts = options();
  await fetchSnapshot('chuo', download, { ...opts, storage: mode === 'no credentials' ? undefined : storage });
  expect(await readdir(path.join(sources, 'chuo'))).not.toContain('old');
  await loadVerifiedSnapshots(['chuo'], sources, data);
  if (mode === 'same') {
    expect(await readdir(sources)).toEqual(['chuo']);
    expect(opts.log).not.toHaveBeenCalled();
  } else {
    const kept = path.join(sources, '.unarchived', 'chuo@2026-10-22');
    expect(await readFile(path.join(kept, 'old'), 'utf8')).toBe('keep');
    expect(opts.log).toHaveBeenCalledWith(expect.stringContaining(kept));
    expect(opts.log).toHaveBeenCalledWith(expect.stringContaining('保管するか'));
  }
  expect(head).toHaveBeenCalledTimes(mode === 'no credentials' ? 0 : 1);
  if (mode !== 'no credentials') expect(head).toHaveBeenCalledWith('snapshots/chuo/2026-10-22/snapshot.json');
});

it('同じ退避名があっても以前の未保管データを上書きしない', async () => {
  const previous = path.join(sources, '.unarchived', 'chuo@2026-10-22');
  await mkdir(previous, { recursive: true });
  await writeFile(path.join(previous, 'earlier'), 'earlier');
  await fetchSnapshot('chuo', download, options());
  expect(await readFile(path.join(previous, 'earlier'), 'utf8')).toBe('earlier');
  const backups = await readdir(path.dirname(previous));
  expect(backups).toHaveLength(2);
  const fresh = backups.find((name) => name !== 'chuo@2026-10-22');
  expect(fresh).toBeDefined();
  expect(await readFile(path.join(path.dirname(previous), fresh ?? '', 'old'), 'utf8')).toBe('keep');
});

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
      options(),
    );
    await expect(result).rejects.toThrow('ビルドに必要');
    await expect(result).rejects.toThrow(kept);
    expect(await readFile(path.join(old, 'sentinel'), 'utf8')).toBe('keep');
  }
  await fetchSnapshot(id, async (dir) => download(dir, files), options());
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

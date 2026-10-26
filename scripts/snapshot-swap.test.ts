import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchSnapshot, replaceDirectory, stageManifest, createManifest } from './snapshots.ts';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), cp: vi.fn(actual.cp) };
});
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => {}) }));

const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let root: string;
let target: string;

beforeEach(async () => {
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  vi.mocked(delay).mockClear();
  vi.mocked(cp).mockReset().mockImplementation(actual.cp);
  await mkdir(path.resolve('.audit'), { recursive: true });
  root = await mkdtemp(path.resolve('.audit/snapshot-swap-'));
  target = path.join(root, 'sources', 'chuo');
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'old'), 'old');
});
afterEach(async () => {
  vi.mocked(rename).mockReset().mockImplementation(actual.rename);
  await rm(root, { recursive: true, force: true });
});

it.each(['EPERM', 'EACCES', 'EBUSY'])('Windowsの一時的なrename失敗を再試行する（%s）', async (code) => {
  let failures = 0;
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (to === target && String(from).includes('-new-') && failures++ < 2) {
      throw Object.assign(new Error('busy'), { code });
    }
    await actual.rename(from, to);
  });
  await replaceDirectory(target, async (temporary) => {
    await writeFile(path.join(temporary, 'new'), 'download');
  });
  expect(await readFile(path.join(target, 'new'), 'utf8')).toBe('download');
  expect(await readdir(path.dirname(target))).toEqual(['chuo']);
  expect(rename).toHaveBeenCalledTimes(4);
  expect(delay).toHaveBeenCalledTimes(2);
});

it.each(['EPERM', 'EIO'])('2回目のrenameが失敗しても新旧一式を保持し、取得先を表示する（%s）', async (code) => {
  let kept = '';
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (from === kept) throw Object.assign(new Error('swap failed'), { code });
    await actual.rename(from, to);
  });
  const result = replaceDirectory(target, async (temporary) => {
    kept = temporary;
    await writeFile(path.join(temporary, 'new'), 'download');
  });
  await expect(result).rejects.toThrow('swap failed');
  await expect(result).rejects.toThrow(kept);
  expect(await readFile(path.join(target, 'old'), 'utf8')).toBe('old');
  expect(await readFile(path.join(kept, 'new'), 'utf8')).toBe('download');
  const delays = vi.mocked(delay).mock.calls.map(([ms]) => ms ?? 0);
  expect(delays.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(10_000);
  expect(rename).toHaveBeenCalledTimes(code === 'EPERM' ? 23 : 3);
  expect(delay).toHaveBeenCalledTimes(code === 'EPERM' ? 20 : 0);
});

it('manifestのcommit失敗でも取得内容を削除せず旧一式を復元する', async () => {
  let kept = '';
  const cleanup = vi.fn(async () => {});
  const result = replaceDirectory(target, async (temporary) => {
    kept = temporary;
    await writeFile(path.join(temporary, 'new'), 'download');
    return {
      commit: async () => {
        throw new Error('commit failed');
      },
      cleanup,
    };
  });
  await expect(result).rejects.toThrow('commit failed');
  await expect(result).rejects.toThrow(kept);
  expect(await readFile(path.join(target, 'old'), 'utf8')).toBe('old');
  expect(await readFile(path.join(kept, 'new'), 'utf8')).toBe('download');
  expect(cleanup).toHaveBeenCalledOnce();
});

it('manifestのrename失敗時は旧manifestと取得内容を保持し、仮manifestを片付ける', async () => {
  const data = path.join(root, 'data');
  const old = await createManifest(target, '2026-10-22');
  await (await stageManifest('chuo', old, data)).commit();
  const manifestPath = path.join(data, 'chuo', 'snapshot.json');
  const before = await readFile(manifestPath);
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (to === manifestPath) throw Object.assign(new Error('manifest failed'), { code: 'EIO' });
    await actual.rename(from, to);
  });
  let kept = '';
  const download = async (dir: string) => {
    kept = dir;
    for (const file of ['list.xlsx', 'vacancy.pdf', 'vacancy_page.html', 'kigyo_page.html', 'facility-pdfs/1.pdf']) {
      await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await writeFile(path.join(dir, file), 'new');
    }
  };
  const result = fetchSnapshot('chuo', download, { sources: path.dirname(target), data, discardUnarchived: ['chuo'] });
  await expect(result).rejects.toThrow('manifest failed');
  await expect(result).rejects.toThrow(kept);
  expect(await readFile(path.join(target, 'old'), 'utf8')).toBe('old');
  expect(await readFile(path.join(kept, 'list.xlsx'), 'utf8')).toBe('new');
  expect(await readFile(manifestPath)).toEqual(before);
  expect(await readdir(path.dirname(manifestPath))).toEqual(['snapshot.json']);
});

it('旧一式のrenameでロールバックできなくてもコピーでsourcesを復元する', async () => {
  let kept = '';
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (to === target) throw Object.assign(new Error('busy'), { code: 'EIO' });
    await actual.rename(from, to);
  });
  await expect(
    replaceDirectory(target, async (temporary) => {
      kept = temporary;
      await writeFile(path.join(temporary, 'new'), 'download');
    }),
  ).rejects.toThrow('busy');
  expect(await readdir(path.dirname(target))).toEqual([path.basename(kept), 'chuo']);
  expect(await readFile(path.join(target, 'old'), 'utf8')).toBe('old');
  expect(await readFile(path.join(kept, 'new'), 'utf8')).toBe('download');
});

it('仮manifestのcleanupが失敗しても元のエラーと取得先を知らせる', async () => {
  let kept = '';
  const result = replaceDirectory(target, async (temporary) => {
    kept = temporary;
    await writeFile(path.join(temporary, 'new'), 'download');
    return {
      commit: async () => {
        throw new Error('commit failed');
      },
      cleanup: async () => {
        throw new Error('cleanup failed');
      },
    };
  });
  await expect(result).rejects.toThrow('commit failed');
  await expect(result).rejects.toThrow(kept);
  expect(await readFile(path.join(target, 'old'), 'utf8')).toBe('old');
  expect(await readFile(path.join(kept, 'new'), 'utf8')).toBe('download');
  await expect(result).rejects.toThrow('cleanup failed');
});

it('ロールバックのコピーも失敗した場合に元のエラーと新旧のパスを保持する', async () => {
  let kept = '';
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (to === target) throw new Error('original swap error');
    await actual.rename(from, to);
  });
  vi.mocked(cp).mockRejectedValue(new Error('rollback copy error'));
  const result = replaceDirectory(target, async (dir) => {
    kept = dir;
    await writeFile(path.join(dir, 'new'), 'new');
  });
  await expect(result).rejects.toThrow('original swap error');
  await expect(result).rejects.toThrow('rollback copy error');
  await expect(result).rejects.toThrow(kept + '-old');
  await expect(result).rejects.toHaveProperty('cause', expect.any(AggregateError));
  expect(await readFile(path.join(kept, 'new'), 'utf8')).toBe('new');
  expect(await readFile(path.join(kept + '-old', 'old'), 'utf8')).toBe('old');
});

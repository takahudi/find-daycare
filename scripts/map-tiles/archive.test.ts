import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeJson } from '../json.ts';
import { sha256 } from '../snapshots.ts';
import type { TilesManifest } from './schema.ts';
import { archiveMapTiles } from './archive.ts';
import { MAP_AREA } from './config.ts';

let root: string;
const bytes = Buffer.from('local PMTiles');
const hash = sha256(bytes);
const key = 'tiles/osaka-20261027.pmtiles';
const manifest: TilesManifest = {
  source: { build: '20261027', url: 'https://build.protomaps.com/20261027.pmtiles', tilesVersion: '4.15.2' },
  bbox: [...MAP_AREA.bbox],
  minZoom: MAP_AREA.minZoom,
  maxZoom: MAP_AREA.maxZoom,
  tiles: 1,
  object: { key, sha256: hash, size: bytes.length },
};
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'map-archive-'));
  await mkdir(path.join(root, 'map-tiles'));
  await mkdir(path.join(root, 'data/map'), { recursive: true });
  await writeFile(path.join(root, 'map-tiles/osaka-20261027.pmtiles'), bytes);
  await writeJson('tiles.json', path.join(root, 'data/map/tiles.json'), manifest);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function storage() {
  return {
    head: vi.fn<() => Promise<{ sha256: string | null } | null>>(async () => null),
    put: vi.fn<() => Promise<'created' | 'exists'>>(async () => 'created'),
    get: vi.fn(async () => bytes),
  };
}

it('同じsha256で保管済みならPUTせず通知する', async () => {
  const store = storage();
  store.head.mockResolvedValue({ sha256: hash });
  const log = vi.fn();
  await archiveMapTiles(store, { root, log });
  expect(store.head).toHaveBeenCalledWith(key);
  expect(store.put).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(`保管済み: ${key}`);
});

it.each(['different', null])('保管済みのsha256が%sなら上書きせず失敗する', async (storedHash) => {
  const store = storage();
  store.head.mockResolvedValue({ sha256: storedHash });
  await expect(archiveMapTiles(store, { root })).rejects.toThrow('既存オブジェクトのsha256');
  expect(store.put).not.toHaveBeenCalled();
});

it.each(['created', 'exists'] as const)('オブジェクトがなければPUTし、%sでもHEADで確認する', async (result) => {
  const store = storage();
  store.head.mockResolvedValueOnce(null).mockResolvedValueOnce({ sha256: hash });
  store.put.mockResolvedValue(result);
  await archiveMapTiles(store, { root, log: vi.fn() });
  expect(store.put).toHaveBeenCalledExactlyOnceWith(key, bytes, hash);
  expect(store.head).toHaveBeenCalledTimes(2);
  expect(store.put.mock.invocationCallOrder[0]).toBeGreaterThan(store.head.mock.invocationCallOrder[0]);
  expect(store.head.mock.invocationCallOrder[1]).toBeGreaterThan(store.put.mock.invocationCallOrder[0]);
});

it.each([null, { sha256: 'different' }, { sha256: null }])('PUT後のHEADが%sなら成功扱いにしない', async (stored) => {
  const store = storage();
  store.head.mockResolvedValueOnce(null).mockResolvedValueOnce(stored);
  await expect(archiveMapTiles(store, { root })).rejects.toThrow('PUT後のsha256');
});

it.each([Buffer.from('same length!!'), Buffer.from('short')])(
  'ローカルファイルが記録と違う場合はネットワークに出ない',
  async (changed) => {
    await writeFile(path.join(root, 'map-tiles/osaka-20261027.pmtiles'), changed);
    const store = storage();
    await expect(archiveMapTiles(store, { root })).rejects.toThrow('ローカルファイルのsha256またはsize');
    expect(store.head).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  },
);

it('記録のサイズが不正な場合はネットワークに出ない', async () => {
  await writeJson('tiles.json', path.join(root, 'data/map/tiles.json'), {
    ...manifest,
    object: { ...manifest.object, size: bytes.length + 1 },
  });
  const store = storage();
  await expect(archiveMapTiles(store, { root })).rejects.toThrow('size');
  expect(store.head).not.toHaveBeenCalled();
});

it('別のbuildや任意のURL・keyを指す記録を拒否する', async () => {
  const text = await readFile(path.join(root, 'data/map/tiles.json'), 'utf8');
  const store = storage();
  await writeFile(path.join(root, 'data/map/tiles.json'), text.replace('tiles/osaka-20261027.pmtiles', 'other/key'));
  await expect(archiveMapTiles(store, { root })).rejects.toThrow('key');
  await writeFile(path.join(root, 'data/map/tiles.json'), text.replace('https://build.protomaps.com', 'https://example.com'));
  await expect(archiveMapTiles(store, { root })).rejects.toThrow('URL');
  expect(store.head).not.toHaveBeenCalled();
});

import { describe, expect, it, vi } from 'vitest';
import { geocode } from './geocode.ts';
import type { WardDataFiles } from '../data-schema.ts';

const hit = (lng: number, lat: number, title: string) => ({
  geometry: { coordinates: [lng, lat] },
  properties: { title },
});
const home = { lat: 34.683, lng: 135.503, label: '大阪府大阪市中央区本町一丁目' };

describe('ビルド時の住所検索', () => {
  it.each([
    ['区', hit(135.5, 34.69, '大阪府大阪市中央区')],
    ['市', hit(135.5, 34.69, '大阪市')],
  ])('先頭が%sレベルなら後続の町名候補を採用せず、キャッシュも変更しない', async (_, first) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([first, hit(home.lng, home.lat, home.label)])),
    );
    const cache: WardDataFiles['geocode-cache.json'] = {};
    await expect(geocode('大阪市中央区本町1丁目', cache)).rejects.toThrow('住所検索で町名まで一致しない: 大阪市中央区本町1');
    expect(cache).toEqual({});
  });

  it('先頭が大阪市外なら後続の市内候補を採用せず、キャッシュも変更しない', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([hit(139.684, 35.684, '東京都渋谷区本町一丁目'), hit(home.lng, home.lat, home.label)])),
    );
    const cache: WardDataFiles['geocode-cache.json'] = {};
    await expect(geocode('大阪市中央区本町1丁目', cache)).rejects.toThrow('住所検索の結果が大阪市外です: 大阪市中央区本町1');
    expect(cache).toEqual({});
  });

  it.each([{}, null, 'invalid'])('配列でない応答は形式エラーにし、キャッシュも変更しない (%j)', async (response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(response)),
    );
    const cache: WardDataFiles['geocode-cache.json'] = {};
    await expect(geocode('大阪市中央区本町1丁目', cache)).rejects.toThrow('住所検索の応答形式が不正: 大阪市中央区本町1');
    expect(cache).toEqual({});
  });

  it.each([{ response: [] }, { response: [null, {}] }])(
    '有効な候補がなければキャッシュを変更せず失敗する (%j)',
    async ({ response }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(response)),
      );
      const cache: WardDataFiles['geocode-cache.json'] = {};
      await expect(geocode('大阪市中央区本町1丁目', cache)).rejects.toThrow('住所検索で町名まで一致しない: 大阪市中央区本町1');
      expect(cache).toEqual({});
    },
  );

  it('不正な候補だけを除き、最初の有効な候補をキャッシュして再利用する', async () => {
    const fetch = vi.fn(async () =>
      Response.json([
        null,
        { geometry: { coordinates: ['135.5', 34.69] }, properties: { title: '大阪市北区中之島' } },
        hit(home.lng, home.lat, home.label),
        hit(135.504, 34.684, '大阪府大阪市中央区本町二丁目'),
      ]),
    );
    vi.stubGlobal('fetch', fetch);
    const cache: WardDataFiles['geocode-cache.json'] = {};
    await expect(geocode('大阪市中央区本町1-2 ビル3階', cache)).resolves.toEqual(home);
    expect(cache).toEqual({ '大阪市中央区本町1-2': home });
    await expect(geocode('大阪市中央区本町1-2 ビル3階', cache)).resolves.toEqual(home);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('HTTPエラーには既存のステータスと検索住所を含める', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    await expect(geocode('大阪市北区中之島1', {})).rejects.toThrow('住所検索に失敗 (503): 大阪市北区中之島1');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { distanceMeters, formatDistance, geocode, walkMinutes } from './geo';

describe('distanceMeters', () => {
  it('同じ地点は0m', () => {
    expect(distanceMeters({ lat: 34.69, lng: 135.5 }, { lat: 34.69, lng: 135.5 })).toBe(0);
  });

  it('緯度1度ぶん南北に離れた2点は約111.2km', () => {
    expect(distanceMeters({ lat: 34, lng: 135.5 }, { lat: 35, lng: 135.5 })).toBeCloseTo(111_195, -2);
  });

  it('北緯60度で経度1度ぶん東西に離れた2点は、南北1度の約半分', () => {
    expect(distanceMeters({ lat: 60, lng: 135 }, { lat: 60, lng: 136 })).toBeCloseTo(55_597, -2);
  });
});

describe('formatDistance', () => {
  it('1km未満は10m単位に丸めて m で表す', () => {
    expect(formatDistance(0)).toBe('0m');
    expect(formatDistance(123)).toBe('120m');
    expect(formatDistance(125)).toBe('130m');
    expect(formatDistance(994)).toBe('990m');
  });

  it('1km以上は小数1桁の km で表す', () => {
    expect(formatDistance(1000)).toBe('1.0km');
    expect(formatDistance(1234)).toBe('1.2km');
    expect(formatDistance(12_345)).toBe('12.3km');
  });
});

describe('walkMinutes', () => {
  it('80m を1分として切り上げる', () => {
    expect(walkMinutes(80)).toBe(1);
    expect(walkMinutes(81)).toBe(2);
    expect(walkMinutes(1500)).toBe(19);
  });

  it('ごく近くても1分とする', () => {
    expect(walkMinutes(0)).toBe(1);
    expect(walkMinutes(10)).toBe(1);
  });
});

interface Candidate {
  title: string;
  lat: number;
  lng: number;
}

function stubAddressSearch(responses: Record<string, Candidate[]>, delayMs: Record<string, number> = {}): string[] {
  const queries: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      queries.push(q);
      await new Promise((resolve) => setTimeout(resolve, delayMs[q] ?? 0));
      return Response.json(
        (responses[q] ?? []).map(({ title, lat, lng }) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: { title },
        })),
      );
    }),
  );
  return queries;
}

describe('geocode', () => {
  it('町名だけの入力は、対象の区ごとに区名を付けて問い合わせる', async () => {
    const queries = stubAddressSearch({
      大阪市中央区本町1丁目: [{ title: '大阪府大阪市中央区本町一丁目', lat: 34.683, lng: 135.503 }],
    });
    await expect(geocode('本町1丁目', ['北区', '中央区', '西区'])).resolves.toEqual({
      lat: 34.683,
      lng: 135.503,
      label: '大阪府大阪市中央区本町一丁目',
    });
    expect(queries).toEqual(['大阪市北区本町1丁目', '大阪市中央区本町1丁目', '大阪市西区本町1丁目', '本町1丁目']);
  });

  it('区名から始まる入力は、その区だけを問い合わせる', async () => {
    const queries = stubAddressSearch({
      大阪市中央区本町1丁目: [{ title: '大阪府大阪市中央区本町一丁目', lat: 34.683, lng: 135.503 }],
    });
    await geocode('中央区本町1丁目', ['北区', '中央区', '西区']);
    expect(queries).toEqual(['大阪市中央区本町1丁目']);
  });

  it('大阪市外の結果は使わない', async () => {
    stubAddressSearch({
      大阪市中央区本町1丁目: [
        { title: '東京都渋谷区本町一丁目', lat: 35.684, lng: 139.684 },
        { title: '大阪府大阪市中央区本町一丁目', lat: 34.683, lng: 135.503 },
      ],
    });
    await expect(geocode('本町1丁目', ['中央区'])).resolves.toMatchObject({ label: '大阪府大阪市中央区本町一丁目' });
  });

  it('区までしか特定できない結果は使わない', async () => {
    const queries = stubAddressSearch({ 大阪市北区: [{ title: '大阪府大阪市北区', lat: 34.705, lng: 135.51 }] });
    await expect(geocode('大阪市北区', ['北区'])).rejects.toThrow('該当する住所が見つかりませんでした');
    expect(queries).toEqual(['大阪市北区']);
  });

  it('町名と丁目が完全に一致する結果を、町名が前方一致するだけの結果や丁目が違う結果より優先する', async () => {
    stubAddressSearch({
      大阪市西成区玉出1丁目: [
        { title: '大阪府大阪市西成区玉出西一丁目', lat: 34.622, lng: 135.494 },
        { title: '大阪府大阪市西成区玉出二丁目', lat: 34.62, lng: 135.497 },
      ],
      大阪市住之江区玉出1丁目: [{ title: '大阪府大阪市住之江区玉出一丁目', lat: 34.615, lng: 135.485 }],
    });
    await expect(geocode('玉出1丁目', ['西成区', '住之江区'])).resolves.toMatchObject({
      label: '大阪府大阪市住之江区玉出一丁目',
    });
  });

  it('完全に一致する結果がなければ、応答の届いた順ではなく対象の区の並びで最初の候補を使う', async () => {
    stubAddressSearch(
      {
        大阪市西成区玉出1丁目: [{ title: '大阪府大阪市西成区玉出西一丁目', lat: 34.622, lng: 135.494 }],
        大阪市住之江区玉出1丁目: [{ title: '大阪府大阪市住之江区玉出西二丁目', lat: 34.615, lng: 135.485 }],
      },
      { 大阪市西成区玉出1丁目: 20 },
    );
    await expect(geocode('玉出1丁目', ['西成区', '住之江区'])).resolves.toMatchObject({
      label: '大阪府大阪市西成区玉出西一丁目',
    });
  });

  it('住所検索APIがエラーを返したら、HTTPステータス付きで失敗を伝える', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    await expect(geocode('大阪市北区', ['北区'])).rejects.toThrow('住所検索に失敗しました（HTTP 503）');
  });
});

describe('住所検索の応答検証', () => {
  it.each([{}, null, 'invalid'])('配列でない応答は現在地ボタンを案内する (%j)', async (response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(response)),
    );
    await expect(geocode('大阪市北区中之島', ['北区'])).rejects.toThrow(
      '住所検索を現在利用できません。「現在地」ボタンをお使いください。',
    );
  });

  it('不正な候補が混在しても複数検索から有効な一致候補を返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const query = new URL(url).searchParams.get('q');
        return Response.json([
          null,
          { geometry: { coordinates: [135.5] }, properties: { title: '大阪市北区中之島' } },
          { geometry: { coordinates: ['135.5', 34.69] }, properties: { title: '大阪市北区中之島' } },
          ...(query === '大阪市北区中之島'
            ? [
                {
                  geometry: { coordinates: [135.5, 34.69] },
                  properties: { title: '大阪市北区中之島' },
                },
              ]
            : []),
        ]);
      }),
    );
    await expect(geocode('中之島', ['北区', '中央区'])).resolves.toEqual({
      lat: 34.69,
      lng: 135.5,
      label: '大阪市北区中之島',
    });
  });

  it('有効な候補が残らなければ該当する住所がないことを伝える', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([null, {}])),
    );
    await expect(geocode('大阪市北区中之島', ['北区'])).rejects.toThrow('該当する住所が見つかりませんでした');
  });
});

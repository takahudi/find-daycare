import { describe, expect, it } from 'vitest';
import { parseJson } from './json.ts';

describe('補完入力のJSON境界', () => {
  it('注記キーを除いてからwebsitesを検証する', () => {
    expect(parseJson('{"_source": "出典", "施設": {"url": "https://example.com", "label": "公式"}}', 'websites.json')).toEqual({
      施設: { url: 'https://example.com', label: '公式' },
    });
  });

  it('注記キーを除いても不正な施設データを拒否する', () => {
    expect(() => parseJson('{"_note": "補正理由", "施設": {"url": 1, "label": "公式"}}', 'websites.json')).toThrow();
  });

  it('注記対象外のファイルでは_キーも検証する', () => {
    expect(() => parseJson('{"_broken": "注記として許可されない"}', 'geocode-cache.json')).toThrow();
  });

  it('GSI応答の座標と名称を検証する', () => {
    expect(
      parseJson('[{"geometry":{"coordinates":[135.5,34.69]},"properties":{"title":"大阪市北区中之島"}}]', 'geocode-response'),
    ).toHaveLength(1);
    expect(() =>
      parseJson('[{"geometry":{"coordinates":["135.5",34.69]},"properties":{"title":"大阪市北区中之島"}}]', 'geocode-response'),
    ).toThrow();
  });
});

const pdf = {
  kana: null,
  capacity: { total: 1, byAge: [1] },
  weekday: null,
  saturday: null,
  services: [],
  url: null,
  approvedOn: null,
};
const kigyo = {
  wardTag: '(01北区)',
  phone: null,
  hours: { weekday: '7:00〜19:00' },
  capacity: null,
  monthlyUpTo: null,
  freeOfCharge: null,
  name: 'A園',
  type: '企業主導型保育事業',
  address: '大阪市北区',
  page: 1,
};

describe('入力JSONの厳密なキー検証', () => {
  it.each([
    ['pdf-details.json', pdf],
    ['manual-details.json', { capacity: null, weekday: null, saturday: null, services: [], url: null, approvedOn: null }],
    ['ward-details.json', { weekday: '7:00〜19:00' }],
    ['websites.json', { url: null, label: '公式' }],
    ['kigyo-details.json', kigyo],
    ['geocode-cache.json', { lat: 34.69, lng: 135.5, label: 'A園' }],
  ] as const)('%sの未知のキーを拒否する', (document, detail) => {
    expect(() => parseJson(JSON.stringify({ A園: detail }), document)).not.toThrow();
    expect(() => parseJson(JSON.stringify({ A園: { ...detail, weekDay: '7:00' } }), document)).toThrow('A園.weekDay');
  });

  it.each(['pdf-details.json', 'manual-details.json', 'ward-details.json'] as const)(
    '%sの定員内の未知キーを拒否する',
    (document) => {
      const { kana: _kana, ...manual } = pdf;
      const detail = document === 'pdf-details.json' ? pdf : document === 'manual-details.json' ? manual : {};
      expect(() =>
        parseJson(JSON.stringify({ A園: { ...detail, capacity: { total: 1, byAge: [1], typo: 1 } } }), document),
      ).toThrow('A園.capacity.typo');
    },
  );

  it('企業主導型の開所時間内の未知キーを拒否する', () => {
    expect(() => parseJson(JSON.stringify({ A園: { ...kigyo, hours: { weekDay: '7:00' } } }), 'kigyo-details.json')).toThrow(
      'A園.hours.weekDay',
    );
  });

  it('型の不一致は施設名とキーのパス付きで拒否する', () => {
    expect(() => parseJson('{"A園":{"url":1,"label":"公式"}}', 'websites.json')).toThrow('A園.url');
  });

  it.each([
    ['1', '数値'],
    [1.5, '整数'],
    [0, '1以上'],
  ])('PDFのページ%sはページ専用のメッセージで拒否する', (page, message) => {
    expect(() => parseJson(JSON.stringify({ A園: { ...kigyo, page } }), 'kigyo-details.json')).toThrow(`PDFのページは${message}`);
  });
});

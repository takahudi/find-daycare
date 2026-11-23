import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePage } from './kigyo-pdf.ts';
import { validateJson } from './json.ts';

// 2026-11-23 取得の認可外保育施設一覧（詳細）PDFの一部。再生成は scripts/kigyo-pdf-fixture.ts
const fixture: { pages: Record<string, [string, number, number][]> } = JSON.parse(
  readFileSync(new URL('fixtures/ninkagai-detail-pages.json', import.meta.url), 'utf8'),
);
const parsed = Object.entries(fixture.pages).map(([page, tokens]) => ({
  page: Number(page),
  blocks: parsePage(tokens.map(([s, x, y]) => ({ s, x, y }))),
}));
const byPhone = (phone: string) => parsed.flatMap((p) => p.blocks).find((b) => b.phone === phone);

describe('認可外保育施設一覧（詳細）PDFのページ', () => {
  it('固定入力の全ページの抽出結果が前回と同じ', async () => {
    await expect(JSON.stringify(parsed, null, 2) + '\n').toMatchFileSnapshot('fixtures/ninkagai-detail-pages.expected.json');
  });

  it('施設名を見出しと施設種別の間の行から読む（出現順では「証明書あり」が入る段）', () => {
    expect(byPhone('06-6924-5005')?.name).toBe('都島まほろ保育園');
    expect(byPhone('06-6768-8408')?.name).toBe('森ノ宮もっきん保育園');
  });

  it('事業開始日と証明書発行日をそれぞれのラベルと同じ行から読む', () => {
    expect(byPhone('06-6948-5969')).toMatchObject({ startedOn: '平成30年4月1日', certifiedOn: '平成30年8月31日' });
    expect(byPhone('06-6351-0022')).toMatchObject({ startedOn: '令和6年4月1日', certifiedOn: '平成29年11月30日' });
  });

  it('電話番号が空欄の施設は電話番号をnullにする', () => {
    const block = parsed.find((p) => p.page === 95)?.blocks.find((b) => b.name === '西大阪保育園');
    expect(block).toMatchObject({ phone: null, type: '企業主導型保育事業' });
  });

  it('設置者名にページ番号のフッターを含めない', () => {
    expect(byPhone('06-6654-7510')?.operator).toBe('株式会社GROW');
  });

  it('企業主導型の抽出結果は kigyo-details.json の検証を通る', () => {
    const kigyo = parsed.flatMap(({ page, blocks }) =>
      blocks.filter((b) => b.type === '企業主導型保育事業').map((b) => [`${page}:${b.phone ?? b.name}`, { ...b, page }]),
    );
    expect(kigyo.length).toBeGreaterThanOrEqual(8);
    expect(() => validateJson('kigyo-details.json', Object.fromEntries(kigyo))).not.toThrow();
  });
});

describe('kigyo-details.json の誤読の検査', () => {
  const detail = {
    wardTag: '(01北区)',
    phone: '06-0000-0000',
    hours: {},
    capacity: null,
    monthlyUpTo: null,
    freeOfCharge: null,
    name: 'A園',
    type: '企業主導型保育事業',
    address: '大阪市北区',
    startedOn: '平成30年4月1日',
    certifiedOn: '平成30年8月31日',
    page: 1,
  };

  it.each(['証明書あり', '一時保育あり 2ヶ月', '定 員 （年齢別内訳は施設にご確認ください）', '施 設 種 別'])(
    '施設名が様式の語なら拒否する（%s）',
    (name) => {
      expect(() => validateJson('kigyo-details.json', { k: { ...detail, name } })).toThrow('施設名が様式の語です');
    },
  );

  it('事業開始日が証明書発行日と同じなら拒否する', () => {
    expect(() => validateJson('kigyo-details.json', { k: { ...detail, startedOn: detail.certifiedOn } })).toThrow(
      '事業開始日が証明書発行日と同じです',
    );
  });

  it('事業開始日が証明書発行日より後でも受け入れる', () => {
    expect(() =>
      validateJson('kigyo-details.json', { k: { ...detail, startedOn: '令和6年4月1日', certifiedOn: '平成29年11月30日' } }),
    ).not.toThrow();
  });
});

// 対象の区と、その一次情報の取得元。区を追加するときはここに1件足し、
// `pnpm data:update` のあと sources/<id>/ に websites.json などの補完ファイルを用意する。
const ORIGIN = 'https://www.city.osaka.lg.jp';

export const WARDS = [
  {
    id: 'chuo',
    name: '中央区',
    /** 大阪市「認可外保育施設一覧（詳細）」PDFでの区の見出し */
    ninkagaiTag: '(05中央区)',
    /** 大阪市「保育施設等一覧」の区ページ（xlsx と各施設の基本情報PDF） */
    listPage: `${ORIGIN}/kodomo/page/0000012677.html`,
    /** 区役所「保育施設等の空き状況」ページ */
    vacancyPage: `${ORIGIN}/chuo/page/0000304732.html`,
    /** 空き情報ページの添付のうち空き人数の表（申込書の様式などと区別する） */
    vacancyFile: /\/\d{8}\.pdf$/,
    /** 区役所「企業主導型保育事業所の空き情報」ページ（ページ内の表を使う） */
    kigyoPage: `${ORIGIN}/chuo/page/0000427719.html`,
    /** 各施設のホームページが載っている区の資料（websites.json の出典） */
    homepageSources: [{ label: '中央区内の認可保育施設情報提供資料', url: `${ORIGIN}/chuo/page/0000683899.html` }],
  },
  {
    id: 'higashinari',
    name: '東成区',
    ninkagaiTag: '(14東成区)',
    listPage: `${ORIGIN}/kodomo/page/0000012687.html`,
    vacancyPage: `${ORIGIN}/higashinari/page/0000398076.html`,
    vacancyFile: /\/\d{6}\.xlsx$/,
    kigyoPage: `${ORIGIN}/higashinari/page/0000498053.html`,
    homepageSources: [
      { label: 'Web版ひがしなりっ子すくすく・つながるフェア（保育園(所)・認定こども園編）', url: `${ORIGIN}/higashinari/page/0000533602.html` },
      { label: 'Web版ひがしなりっ子すくすく・つながるフェア（小規模保育事業編）', url: `${ORIGIN}/higashinari/page/0000537377.html` },
    ],
  },
  {
    id: 'tennoji',
    name: '天王寺区',
    ninkagaiTag: '(09天王寺区)',
    listPage: `${ORIGIN}/kodomo/page/0000012681.html`,
    vacancyPage: `${ORIGIN}/tennoji/page/0000297747.html`,
    vacancyFile: /\/tennojihoikusyo\d{8}\.pdf$/,
    kigyoPage: `${ORIGIN}/tennoji/page/0000428536.html`,
    homepageSources: [
      { label: '保育所・保育園・認定こども園', url: `${ORIGIN}/tennoji/page/0000630976.html` },
      { label: '小規模保育施設情報', url: `${ORIGIN}/tennoji/page/0000630981.html` },
      { label: '企業主導型保育施設情報', url: `${ORIGIN}/tennoji/page/0000630979.html` },
    ],
  },
  {
    id: 'naniwa',
    name: '浪速区',
    ninkagaiTag: '(10浪速区)',
    listPage: `${ORIGIN}/kodomo/page/0000012682.html`,
    vacancyPage: `${ORIGIN}/naniwa/page/0000294126.html`,
    vacancyFile: /\/\d{6}ninka\.pdf$/,
    kigyoPage: `${ORIGIN}/naniwa/page/0000515641.html`,
    /** 企業主導型の空き情報の表に所在地・電話がない区は、この区のページの表（施設名・所在地）で補う */
    kigyoInfoPage: `${ORIGIN}/naniwa/page/0000596666.html`,
    homepageSources: [
      { label: '認可保育所（民間）', url: `${ORIGIN}/naniwa/page/0000627513.html` },
      { label: '認可保育所（公立・公設置民営）', url: `${ORIGIN}/naniwa/page/0000627522.html` },
      { label: '認可保育所（小規模保育施設）', url: `${ORIGIN}/naniwa/page/0000627521.html` },
      { label: '認定こども園', url: `${ORIGIN}/naniwa/page/0000627524.html` },
      { label: '認可外保育施設', url: `${ORIGIN}/naniwa/page/0000627525.html` },
    ],
  },
  {
    id: 'nishi',
    name: '西区',
    ninkagaiTag: '(06西区)',
    listPage: `${ORIGIN}/kodomo/page/0000012678.html`,
    // 空き人数はページ本文の表のみで公表（添付ファイルなし）
    vacancyPage: `${ORIGIN}/nishi/page/0000344800.html`,
    vacancyFile: null,
    kigyoPage: `${ORIGIN}/nishi/page/0000428046.html`,
    homepageSources: [
      { label: '西区内保育施設', url: `${ORIGIN}/nishi/page/0000064040.html` },
      { label: '西区内幼稚園・認定こども園', url: `${ORIGIN}/nishi/page/0000508346.html` },
    ],
  },
  {
    id: 'ikuno',
    name: '生野区',
    ninkagaiTag: '(15生野区)',
    listPage: `${ORIGIN}/kodomo/page/0000012688.html`,
    vacancyPage: `${ORIGIN}/ikuno/page/0000311689.html`,
    vacancyFile: /\/hoikusyo[\d.]+\.pdf$/,
    kigyoPage: `${ORIGIN}/ikuno/page/0000518124.html`,
    /** 企業主導型の空き情報をページ内の表ではなくPDFで公表している区は、その添付ファイル */
    kigyoFile: /\/kigyou[\d.]+\.pdf$/,
    // 区の施設紹介（https://www.city.osaka.lg.jp/ikuno/page/0000512877.html）には公式サイトの記載がない
    homepageSources: [],
  },
  {
    id: 'abeno',
    name: '阿倍野区',
    ninkagaiTag: '(19阿倍野区)',
    listPage: `${ORIGIN}/kodomo/page/0000012692.html`,
    // 空き人数はページ本文の表のみで公表
    vacancyPage: `${ORIGIN}/abeno/page/0000297367.html`,
    vacancyFile: null,
    kigyoPage: `${ORIGIN}/abeno/page/0000528611.html`,
    /** 企業主導型の空き情報の表に所在地がない区で、所在地・電話を載せた添付PDF（企業主導型保育事業所一覧） */
    kigyoInfoFile: /kigyouichiran\.pdf$/,
    homepageSources: [{ label: '阿倍野区の保育施設等紹介', url: `${ORIGIN}/abeno/page/0000541040.html` }],
  },
  {
    id: 'joto',
    name: '城東区',
    ninkagaiTag: '(17城東区)',
    listPage: `${ORIGIN}/kodomo/page/0000012690.html`,
    // 空き人数はページ本文の表のみで公表
    vacancyPage: `${ORIGIN}/joto/page/0000598555.html`,
    vacancyFile: null,
    kigyoPage: `${ORIGIN}/joto/page/0000611270.html`,
    homepageSources: [{ label: '城東区内の保育施設・事業について', url: `${ORIGIN}/joto/page/0000685190.html` }],
  },
  {
    id: 'kita',
    name: '北区',
    ninkagaiTag: '(01北区)',
    listPage: `${ORIGIN}/kodomo/page/0000012672.html`,
    vacancyPage: `${ORIGIN}/kita/page/0000529167.html`,
    vacancyFile: /\/hoikuaki\d+\.xlsx$/,
    kigyoPage: `${ORIGIN}/kita/page/0000556646.html`,
    kigyoFile: /\/kigyouaki\d+\.xlsx$/,
    homepageSources: [{ label: '北区内 認可保育施設について', url: `${ORIGIN}/kita/page/0000629031.html` }],
  },
  {
    id: 'miyakojima',
    name: '都島区',
    ninkagaiTag: '(02都島区)',
    listPage: `${ORIGIN}/kodomo/page/0000012673.html`,
    // 空き人数はページ本文の表で公表（オープンデータのxlsも同じ内容）
    vacancyPage: `${ORIGIN}/miyakojima/page/0000296643.html`,
    vacancyFile: null,
    kigyoPage: `${ORIGIN}/miyakojima/page/0000428847.html`,
    // 区の施設情報（https://www.city.osaka.lg.jp/miyakojima/page/0000539973.html）には公式サイトの記載がない
    homepageSources: [],
  },
  {
    id: 'fukushima',
    name: '福島区',
    ninkagaiTag: '(03福島区)',
    listPage: `${ORIGIN}/kodomo/page/0000012674.html`,
    // 空き人数はページ本文の表のみで公表
    vacancyPage: `${ORIGIN}/fukushima/page/0000498894.html`,
    vacancyFile: null,
    // 表は施設名と空き人数のみ。所在地・電話は市の認可外保育施設一覧（詳細）と施設名で対応付ける
    kigyoPage: `${ORIGIN}/fukushima/page/0000428817.html`,
    homepageSources: [{ label: '保育施設のご紹介', url: `${ORIGIN}/fukushima/page/0000510660.html` }],
  },
  {
    id: 'nishinari',
    name: '西成区',
    ninkagaiTag: '(24西成区)',
    listPage: `${ORIGIN}/kodomo/page/0000012697.html`,
    // 空き人数はページ本文の表で公表（添付PDFも同じ内容）
    vacancyPage: `${ORIGIN}/nishinari/page/0000297848.html`,
    vacancyFile: null,
    // 空き情報の表の下に所在地・連絡先の一覧表がある
    kigyoPage: `${ORIGIN}/nishinari/page/0000428773.html`,
    // 区のサイトに各施設のホームページを載せた資料がない
    homepageSources: [],
  },
  {
    id: 'higashisumiyoshi',
    name: '東住吉区',
    ninkagaiTag: '(22東住吉区)',
    listPage: `${ORIGIN}/kodomo/page/0000012695.html`,
    // 空き人数はページ本文の表（保育所・認定こども園・小規模の3つ）で公表（添付PDFも同じ内容）
    vacancyPage: `${ORIGIN}/higashisumiyoshi/page/0000309073.html`,
    vacancyFile: null,
    kigyoPage: `${ORIGIN}/higashisumiyoshi/page/0000445313.html`,
    homepageSources: [
      { label: '保育所（園）', url: `${ORIGIN}/higashisumiyoshi/page/0000386167.html` },
      { label: '認定こども園・小規模保育施設', url: `${ORIGIN}/higashisumiyoshi/page/0000386168.html` },
    ],
  },
  {
    id: 'sumiyoshi',
    name: '住吉区',
    ninkagaiTag: '(21住吉区)',
    listPage: `${ORIGIN}/kodomo/page/0000012694.html`,
    // 空き人数はページ本文の表で公表（添付PDFも同じ内容）
    vacancyPage: `${ORIGIN}/sumiyoshi/page/0000293166.html`,
    vacancyFile: null,
    kigyoPage: `${ORIGIN}/sumiyoshi/page/0000466572.html`,
    homepageSources: [{ label: '幼稚園・認定こども園・保育所（園）・地域型保育事業所', url: `${ORIGIN}/sumiyoshi/page/0000191601.html` }],
  },
  {
    id: 'hirano',
    name: '平野区',
    ninkagaiTag: '(23平野区)',
    listPage: `${ORIGIN}/kodomo/page/0000012696.html`,
    // 空き人数はページ本文の表で公表（添付PDFも同じ内容）
    vacancyPage: `${ORIGIN}/hirano/page/0000560635.html`,
    vacancyFile: null,
    kigyoPage: `${ORIGIN}/hirano/page/0000563316.html`,
    // 施設ごとの紹介PDFの「URL」欄
    homepageSources: [{ label: '平野区幼稚園・保育園(所)等情報（保育施設等一覧）', url: `${ORIGIN}/hirano/page/0000566457.html` }],
  },
  {
    id: 'tsurumi',
    name: '鶴見区',
    ninkagaiTag: '(18鶴見区)',
    listPage: `${ORIGIN}/kodomo/page/0000012691.html`,
    vacancyPage: `${ORIGIN}/tsurumi/page/0000305690.html`,
    vacancyFile: /\/\d{6}\.xls$/,
    kigyoPage: `${ORIGIN}/tsurumi/page/0000431965.html`,
    kigyoFile: /\/\d{6}\.pdf$/,
    // 施設の写真が公式サイトへのリンクになっている
    homepageSources: [{ label: '鶴見区幼稚園・保育所等への入所をお考えの方に情報を提供します', url: `${ORIGIN}/tsurumi/page/0000605717.html` }],
  },
  {
    id: 'asahi',
    name: '旭区',
    ninkagaiTag: '(16旭区)',
    listPage: `${ORIGIN}/kodomo/page/0000012689.html`,
    // 空き人数は添付PDFの表のみで公表（ビルド時に列の位置で読んで照合する）
    vacancyPage: `${ORIGIN}/asahi/page/0000324254.html`,
    vacancyFile: /\/aki\d+\.pdf$/,
    kigyoPage: `${ORIGIN}/asahi/page/0000436879.html`,
    kigyoFile: /\/kisyu\d+\.pdf$/,
    // 区の資料（幼稚園・保育園(所)情報フェア https://www.city.osaka.lg.jp/asahi/page/0000509466.html の施設PDFは画像のみ、
    // 保育施設等一覧 https://www.city.osaka.lg.jp/asahi/page/0000680318.html ）には公式サイトの記載がない
    homepageSources: [],
  },
  {
    id: 'yodogawa',
    name: '淀川区',
    ninkagaiTag: '(12淀川区)',
    listPage: `${ORIGIN}/kodomo/page/0000012685.html`,
    // 空き人数はページ本文の表で公表（添付PDFも同じ内容）
    vacancyPage: `${ORIGIN}/yodogawa/page/0000230131.html`,
    vacancyFile: null,
    // 所在地・電話の一覧表と空き情報の表の2つがある
    kigyoPage: `${ORIGIN}/yodogawa/page/0000428178.html`,
    // 区の施設一覧（https://www.city.osaka.lg.jp/yodogawa/page/0000647736.html）には公式サイトの記載がない
    homepageSources: [],
  },
  {
    id: 'higashiyodogawa',
    name: '東淀川区',
    ninkagaiTag: '(13東淀川区)',
    listPage: `${ORIGIN}/kodomo/page/0000012686.html`,
    vacancyPage: `${ORIGIN}/higashiyodogawa/page/0000384972.html`,
    vacancyFile: /\/R[\d.]+\.xls$/,
    /** 空き情報の凡例が「空欄は空きなし」（受入れのないクラスは「×」や空白のセル）の区。空欄を0として読む */
    blankIsZero: true,
    kigyoPage: `${ORIGIN}/higashiyodogawa/page/0000433822.html`,
    // 区の施設一覧（https://www.city.osaka.lg.jp/higashiyodogawa/page/0000656793.html）には公式サイトの記載がない
    homepageSources: [],
  },
  {
    id: 'nishiyodogawa',
    name: '西淀川区',
    ninkagaiTag: '(11西淀川区)',
    listPage: `${ORIGIN}/kodomo/page/0000012683.html`,
    // 空き人数はページ本文の表で公表（添付PDFも同じ内容）
    vacancyPage: `${ORIGIN}/nishiyodogawa/page/0000457477.html`,
    vacancyFile: null,
    // 所在地・電話の一覧表（大阪市マップナビの座標つき）と空き情報の表の2つがある
    kigyoPage: `${ORIGIN}/nishiyodogawa/page/0000532065.html`,
    homepageSources: [{ label: '認可保育施設等（保育所・認定こども園・地域型保育事業）一覧表', url: `${ORIGIN}/nishiyodogawa/page/0000142294.html` }],
  },
  {
    id: 'konohana',
    name: '此花区',
    ninkagaiTag: '(04此花区)',
    listPage: `${ORIGIN}/kodomo/page/0000012676.html`,
    // 空き人数はページ本文の表（保育所(園)・小規模保育の2つ）で公表（添付PDFも同じ内容）
    vacancyPage: `${ORIGIN}/konohana/page/0000648456.html`,
    vacancyFile: null,
    // 表は施設名と空き人数のみ。所在地・電話は市の認可外保育施設一覧（詳細）と施設名で対応付ける
    kigyoPage: `${ORIGIN}/konohana/page/0000674779.html`,
    // 区の保育施設一覧（空き情報ページの添付PDF）には公式サイトの記載がない
    homepageSources: [],
  },
  {
    id: 'minato',
    name: '港区',
    ninkagaiTag: '(07港区)',
    listPage: `${ORIGIN}/kodomo/page/0000012679.html`,
    // 空き人数はページ本文の表で公表（添付PDFも同じ内容）
    vacancyPage: `${ORIGIN}/minato/page/0000310879.html`,
    vacancyFile: null,
    // 表は施設名と空き人数のみ。所在地・電話は市の認可外保育施設一覧（詳細）と施設名で対応付ける
    kigyoPage: `${ORIGIN}/minato/page/0000428485.html`,
    // 認可施設の公式サイトは区の資料（【港区内】保育施設等 一覧 https://www.city.osaka.lg.jp/minato/page/0000314717.html）に記載がない。
    // 企業主導型は空き情報のページに各施設の公式サイトへのリンクがある（websites.json に転記）
    homepageSources: [],
  },
  {
    id: 'taisho',
    name: '大正区',
    ninkagaiTag: '(08大正区)',
    listPage: `${ORIGIN}/kodomo/page/0000012680.html`,
    // 空き人数はページ本文の表のみで公表
    vacancyPage: `${ORIGIN}/taisho/page/0000433373.html`,
    vacancyFile: null,
    kigyoPage: `${ORIGIN}/taisho/page/0000494825.html`,
    // 施設ごとの紹介PDFの「ホームページアドレス」欄
    homepageSources: [{ label: '大正区子育てねっと', url: `${ORIGIN}/taisho/page/0000430842.html` }],
  },
  {
    id: 'suminoe',
    name: '住之江区',
    ninkagaiTag: '(20住之江区)',
    listPage: `${ORIGIN}/kodomo/page/0000012693.html`,
    // 認可施設の空き人数はページ本文の表で公表（添付PDFも同じ内容）
    vacancyPage: `${ORIGIN}/suminoe/page/0000496286.html`,
    vacancyFile: null,
    // 企業主導型の専用ページはなく、空き情報ページの添付PDFの下段「【企業主導型保育事業所】」の表で公表している。
    // 表は施設名と空き人数のみなので、所在地・電話は市の認可外保育施設一覧（詳細）と施設名で対応付ける
    kigyoPage: `${ORIGIN}/suminoe/page/0000496286.html`,
    kigyoFile: /\/bosyuusuu\.pdf$/,
    /** 企業主導型の表が添付PDFの一部にある区で、その表の見出し */
    kigyoPdfSection: '【企業主導型保育事業所】',
    homepageSources: [{ label: '保育所（園）・認定こども園・地域型保育事業所', url: `${ORIGIN}/suminoe/page/0000504109.html` }],
  },
];

export const CITY_SOURCES = {
  /** 大阪市「保育施設等 空き情報マップ」のデータ（全市・緯度経度つき） */
  vacancyCsv: `${ORIGIN}/contents/wdu110/sukusuku/sukusukudata.csv`,
  vacancyMap: `${ORIGIN}/contents/wdu110/sukusuku/map.html`,
  /** 大阪市「地域の児童が利用できる認可外保育施設一覧」 */
  ninkagaiPage: `${ORIGIN}/kodomo/page/0000585842.html`,
};

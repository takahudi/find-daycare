# 大阪市 保育施設 空き状況マップ

大阪市全24区の保育施設（保育所・認定こども園・地域型保育事業・企業主導型保育事業所）の **クラス年齢別の空き人数** を、カード一覧と地図で確認できる Web アプリです。

公開サイト: https://osaka.hoiku-map.com/

## 主な機能

- **カード一覧**: 施設ごとの 0〜5歳クラス別の空き人数（空きあり／空きなし／受入れ対象外・共有枠に対応）、区・施設種別・認可区分・設置区分、定員、開園時間、住所・電話、運営法人、特別保育、地図表示ボタン、公式サイト・市の資料PDF・Googleマップへのリンクを表示
- **地図**: 自前ホストのベクトルタイルとキャンバス描画で全施設をピン表示（認可外は角丸の四角いピン、数字は選択中のクラス年齢の空き人数）。カードと地図が相互に連動し、自宅を設定するとズームボタンの下に「自宅に戻る」ボタンを表示
- **自宅から近い順**: 住所検索（国土地理院 住所検索API）または現在地から自宅を設定すると、直線距離・徒歩目安（80m/分）付きで近い順に並べ替え、地図上に自宅と選択施設を結ぶ線を表示。設定後は1行のステータスバーに折り畳まれ、自宅の位置はブラウザ（`localStorage`）のみに保存して URL には含めない（[ADR 0002](docs/adr/0002-home-location-never-leaves-device.md)）
- **絞り込み・並び替え・URL 共有**: 折りたたみ式の区・施設種別パネル（全選択／解除つき）、クラス年齢（複数選択可）、「空きありのみ」チップ、一覧ヘッダーの並び順（自宅から近い順／空きが多い順／名前順）で絞り込み可能。絞り込み条件と選択中の施設は `nuqs` で URL クエリに保持して共有可能（[ADR 0004](docs/adr/0004-share-filters-and-selected-facility-in-url.md)）
- **空き情報の時点と期限切れ警告**: ヘッダーに空き情報の時点を1行表示し、詳細パネルで各区の時点・出典を確認可能。入所日（入所月の1日・日本時間0時）を過ぎた区の空き情報には警告を表示（企業主導型保育事業所は対象外）
- **モバイル表示**: スマホ幅（860px以下）では「リスト／地図」タブとヘッダー・絞り込みの折りたたみ切替に対応

### 利用上の注意

- 空き人数は月1回の公表値で日々変動します。申込み前に必ず各区の保健福祉センター（区役所）や各施設にご確認ください。
- 距離は直線距離です（実際の道のりはこれより長くなります）。
- 企業主導型保育事業所は認可外保育施設です。利用は施設との直接契約となり、表示している空き人数は「地域枠」の数です。

## 開発環境のセットアップ

Node.js 26（`.node-version`）と pnpm 12（`package.json` の `packageManager`）を使用します。

```bash
pnpm install
pnpm dev
# → http://localhost:5173
```

Cloudflare Vite プラグインにより Workers 実行環境（workerd）で動作します。ローカルで地図タイルを表示するには、下の「地図タイルを作る・保管する」の手順でローカル R2 に PMTiles を配置してください。本番ビルドの確認には `pnpm build && pnpm preview` を使用します。

### チェック・テスト

```bash
pnpm check      # 整形確認・lint・型チェック・単体テスト・ビルド（CI と同一）
pnpm lint       # Worker 型生成のうえ oxlint を実行
pnpm typecheck  # Worker 型生成のうえ tsc -b を実行
pnpm test       # 単体テスト（Vitest。src/data/facilities.json の検証を含む）
pnpm test:e2e   # E2E・アクセシビリティテスト（Playwright + axe-core。初回は pnpm exec playwright install --only-shell chromium）
pnpm format     # oxfmt で整形
```

`pnpm install` 時に lefthook が Git フックを設定します（コミット時はステージ済みファイルの lint・整形、プッシュ時は型チェックと単体テスト）。

## データの更新

一次情報の更新はローカルで実行し、差分を確認して PR を作成します（[ADR 0003](docs/adr/0003-manual-local-data-updates-via-pr.md)）。対象24区と取得元は [scripts/wards.ts](scripts/wards.ts) で定義しています。

```bash
pnpm data:fetch    # 市・区の公開ページから一次情報を sources/ に取得しマニフェストを更新
pnpm data:build    # マニフェスト検証・PDF抽出・照合を行い src/data/facilities.json と data/build-warnings.txt を再生成
pnpm data:archive  # レビュー後に一次情報を R2 に保管
```

`pnpm data:update` で `data:fetch` と `data:build` を続けて実行できます。生成時の警告は `data/build-warnings.txt` に書き出され、前回からの差分を確認できます。公開データと補完ファイルは `src/schema.ts` / `scripts/data-schema.ts` の Valibot スキーマで検証します。

### 一次情報を保管・復元する

一次情報の元ファイルは Git に含めず、非公開の R2 バケットに区ごと・全市共通のスナップショットとして保管します（[ADR 0001](docs/adr/0001-raw-sources-in-r2-per-ward-snapshots.md)）。`.env.example` を `.env` にコピーし、一次情報用バケットに対する **Object Read & Write** 権限の R2 API トークンを設定してください。

```dotenv
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

```bash
pnpm data:archive [id ...]                      # 全単位または指定した単位を R2 に保管
pnpm data:restore [id[@YYYY-MM-DD] ...]         # マニフェストの取得日または指定日付を sources/ へ復元（--dest で出力先変更可）
pnpm data:verify [id ...]                       # sources/ を data/<id>/snapshot.json と照合
pnpm data:manifest [id ...] [--date YYYY-MM-DD] # 既存の sources/ からマニフェストを作成
```

未保管の `sources/<id>/` を置換する場合は安全のため停止します。破棄して差し替える場合は `--discard-unarchived <id>` を明示してください。

## 地図タイルを作る・保管する

Protomaps の日次ビルドから大阪市の範囲（[scripts/map-tiles/config.ts](scripts/map-tiles/config.ts)）の z0〜15 を切り出し、`map-tiles/osaka-<build>.pmtiles` とマニフェスト `data/map/tiles.json` を生成します。PMTiles 本体は Git に含めず、地図専用の非公開 R2 バケットに保管します。

```bash
# PMTiles の切り出し（--build 省略時は data/map/tiles.json の版を再生成）
pnpm map:extract --build 20261027

# ローカル開発用の R2（.wrangler/state）へ投入
pnpm map:local

# レビュー後に本番用 R2 へ保管（.env の地図用 R2 認証情報が必要）
pnpm map:archive
```

地図用 R2 バケットの認証情報は `.env.example` を参考に `.env` へ設定してください（一次情報用バケットとは分離）。

```dotenv
R2_ACCOUNT_ID=
R2_MAP_ACCESS_KEY_ID=
R2_MAP_SECRET_ACCESS_KEY=
R2_MAP_BUCKET=
```

地図用フォント・スプライト（`public/map/assets/`）は [basemaps-assets](https://github.com/protomaps/basemaps-assets) の固定コミットから静的アセットとして配信します。タイル更新時に必要なグリフ範囲を再走査・再取得する場合は次を実行します。

```bash
pnpm map:glyphs  # ローカルの PMTiles から必要なグリフ範囲を走査し data/map/glyph-coverage.json を更新
pnpm map:assets  # フォント・スプライトを取得し data/map/assets.json を更新
```

## デプロイ

Cloudflare Workers Static Assets + R2（`wrangler.jsonc`）にデプロイします。Worker は `/map/tiles/<build>/<z>/<x>/<y>.mvt` を R2 の PMTiles から配信し、それ以外は静的アセットを配信します。

GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）により、PR ではチェック・E2E 通過後にプレビューデプロイを作成し、`main` へのマージで本番環境へデプロイします。デプロイにはリポジトリの Secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が必要です。

## 技術スタック・構成

- **フロントエンド**: Vite 8 / React 19（React Compiler） / TypeScript / CSS Modules
- **状態管理・検証**: nuqs / Valibot
- **地図**: MapLibre GL JS（react-map-gl/maplibre） / PMTiles / `@protomaps/basemaps`
- **ホスティング**: Cloudflare Workers Static Assets / Cloudflare R2
- **テスト・品質**: Vitest / Playwright + axe-core / oxlint / oxfmt

```text
src/
  main.tsx               エントリポイント（データ読み込み・検証、NuqsAdapter）
  schema.ts              公開データ・自宅位置の Valibot スキーマと型
  app/                   画面全体の組み立て・モバイルヘッダー制御・エラー画面
  features/
    dataset/             見出し・出典・期限切れの空き情報警告
    facilities/          施設一覧・施設カード・選択状態とスクロール
    filters/             折りたたみ式絞り込みUI・URLクエリ連携
    home/                自宅の住所検索・現在地フォーム
    map/                 地図本体・カメラ制御・自宅ボタン・ピン描画・ポップアップ・凡例
  lib/                   データ読み込み・集計・絞り込み・距離計算・住所検索・期限切れ判定・ラベル定義
  data/facilities.json   生成データ（ハッシュ付き静的アセットとして実行時に読み込み）
worker/                  Cloudflare Worker（/map/tiles/* の R2 PMTiles 配信と静的アセット配信）
scripts/                 一次情報の取得・検証・保管・復元・抽出・ビルド、地図タイル・アセット生成
data/                    区ごとの抽出・補完JSON、スナップショットマニフェスト、build-warnings.txt、地図メタデータ
public/                  静的アセット（_headers、地図用フォント・スプライト等）
e2e/                     Playwright + axe-core による E2E・アクセシビリティテスト
docs/adr/                アーキテクチャ決定記録（ADR）
GLOSSARY.md              ドメイン用語集
```

設計判断の背景は [docs/adr/](docs/adr/)、用語の定義は [GLOSSARY.md](GLOSSARY.md) を参照してください。

## データの出典・ライセンス

- **保育施設・空き情報**: 大阪市および各区役所の公開情報（[保育施設等 空き情報マップ](https://www.city.osaka.lg.jp/contents/wdu110/sukusuku/map.html)、[地域の児童が利用できる認可外保育施設一覧](https://www.city.osaka.lg.jp/kodomo/page/0000585842.html)、各区の空き情報・保育施設等一覧。全24区の参照先は [scripts/wards.ts](scripts/wards.ts)）
- **住所検索**: [国土地理院 住所検索API](https://msearch.gsi.go.jp/address-search/AddressSearch)
- **地図タイル**: [Protomaps Basemap](https://docs.protomaps.com/basemaps/downloads) / [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)（[ODbL](https://opendatacommons.org/licenses/odbl/)）
- **地図フォント・アイコン**: Noto Sans glyphs（[SIL Open Font License 1.1](public/map/assets/fonts/OFL.txt)）、[basemaps-assets](https://github.com/protomaps/basemaps-assets) v4 light sprite（[MIT License](https://github.com/tangrams/icons/blob/master/LICENSE.md)）

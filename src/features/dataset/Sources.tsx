import type { Dataset } from '../../schema';
import type { DatasetSummary } from '../../lib/dataset-summary';
import styles from './Sources.module.css';

export function Sources({ data, summary: { wardNames, asOfLabels } }: { data: Dataset; summary: DatasetSummary }) {
  return (
    <footer className={styles.sources}>
      <p>
        空き人数は{asOfLabels.join('／')}の情報です。日々変動するため、利用申込みの前に必ず各区の保健福祉センター（
        {wardNames.map((n) => `${n}役所`).join('・')}）または各施設へご確認ください。距離は直線距離です。
      </p>
      <p>
        企業主導型保育事業所は認可外保育施設です。利用は施設と保護者の直接契約で、区役所の利用調整の対象外です。利用料・対象年齢・利用条件は施設ごとに異なるため、見学のうえ施設へ直接お問い合わせください（空き人数は地域枠の数）。
      </p>
      <ul>
        {[...data.wards.flatMap((w) => w.sources), ...data.commonSources].map((s) => (
          <li key={s.url + s.label}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </li>
        ))}
        <li>
          住所検索：
          <a href="https://msearch.gsi.go.jp/address-search/AddressSearch" target="_blank" rel="noreferrer">
            国土地理院 住所検索API
          </a>
          ／ 地図：国土地理院 地理院タイル（淡色地図）
        </li>
      </ul>
    </footer>
  );
}

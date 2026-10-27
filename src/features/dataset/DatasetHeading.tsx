import type { Dataset, Ward } from '../../schema';
import type { DatasetSummary } from '../../lib/dataset-summary';
import { VacancyExpiryWarning } from './VacancyExpiry';
import { SiteTitle } from './SiteTitle';
import styles from './DatasetHeading.module.css';

export function DatasetHeading({
  data,
  summary,
  expiredWards,
}: {
  data: Dataset;
  summary: DatasetSummary;
  expiredWards: Ward[];
}) {
  const { wardNames, title, asOfLabels, kigyoAsOfText } = summary;
  const wardTitle = `対象: ${wardNames.join('・')}`;
  return (
    <div>
      <SiteTitle area={title} title={wardTitle} />
      <p className={styles.asOf}>
        空き情報：
        {asOfLabels.length === 1 ? (
          <strong>{asOfLabels[0]}</strong>
        ) : (
          data.wards.map((w) => (
            <span key={w.id}>
              {w.name} <strong>{w.vacancyAsOf}</strong>（{w.vacancyFor}）{' '}
            </span>
          ))
        )}
        {kigyoAsOfText && <>・企業主導型（地域枠）は{kigyoAsOfText}</>}・出典 大阪市・各区役所
      </p>
      <VacancyExpiryWarning expiredWards={expiredWards} wardCount={data.wards.length} />
    </div>
  );
}

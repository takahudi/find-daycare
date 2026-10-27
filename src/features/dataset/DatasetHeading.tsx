import type { Dataset } from '../../schema';
import type { DatasetSummary } from '../../lib/dataset-summary';

export function DatasetHeading({ data, summary }: { data: Dataset; summary: DatasetSummary }) {
  const { wardNames, title, asOfLabels, kigyoAsOfText } = summary;
  const wardTitle = `対象: ${wardNames.join('・')}`;
  return (
    <div className="topbar__title">
      <h1 title={wardTitle}>
        {title}の保育施設 <span>空き状況マップ</span>
      </h1>
      <p className="topbar__asof">
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
    </div>
  );
}

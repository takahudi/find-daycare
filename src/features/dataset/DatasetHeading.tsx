import { useEffect, useId, useRef, useState } from 'react';
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailsId = useId();

  useEffect(() => {
    if (!detailsOpen) return undefined;
    const onDocumentClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setDetailsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [detailsOpen]);

  return (
    <div>
      <SiteTitle area={title} title={wardTitle} />
      <div ref={containerRef} className={styles.meta}>
        <p className={styles.asOf}>
          <span className={styles.asOfText}>
            空き情報：<strong>{asOfLabels[0]}</strong>
            {asOfLabels.length > 1 && ' ほか'}
          </span>
          <button
            ref={triggerRef}
            type="button"
            className={styles.infoButton}
            aria-label="空き情報と出典の詳細"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((current) => !current)}
          >
            <span aria-hidden="true">i</span>
          </button>
        </p>
        {detailsOpen && (
          <div id={detailsId} className={styles.detailsPanel}>
            {asOfLabels.length === 1 ? (
              <p>
                空き情報：<strong>{asOfLabels[0]}</strong>
              </p>
            ) : (
              <p>
                空き情報：
                {data.wards.map((w) => (
                  <span key={w.id}>
                    {w.name} <strong>{w.vacancyAsOf}</strong>（{w.vacancyFor}）{' '}
                  </span>
                ))}
              </p>
            )}
            {kigyoAsOfText && <p>企業主導型（地域枠）：{kigyoAsOfText}</p>}
            <p>出典：大阪市・各区役所</p>
          </div>
        )}
      </div>
      <VacancyExpiryWarning expiredWards={expiredWards} wardCount={data.wards.length} />
    </div>
  );
}

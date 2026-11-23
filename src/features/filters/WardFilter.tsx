import { useEffect, useId, useRef, useState } from 'react';
import type { Ward } from '../../schema';
import { formatWardSummary } from './ward-summary';
import styles from './Filters.module.css';

interface Props {
  wards: Ward[];
  wardIds: string[];
  onToggle: (wardId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export function WardFilter({ wards, wardIds, onToggle, onSelectAll, onClearAll }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const summaryId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const allSelected = wardIds.length === wards.length;
  const noneSelected = wardIds.length === 0;
  const summary = formatWardSummary(wards, wardIds);

  return (
    <div ref={containerRef} className={`${styles.group} ${styles.wardFilter}`}>
      <span id="filter-ward" className={styles.label}>
        区
      </span>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.chip} ${styles.wardTrigger}${!allSelected ? ` ${styles.on}` : ''}`}
        aria-labelledby={`filter-ward ${summaryId}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span id={summaryId}>{summary}</span>
        <span className={styles.caret} aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} className={styles.wardPanel}>
          <div className={styles.wardActions}>
            <span className={styles.wardCount}>
              {wardIds.length} / {wards.length}区を選択中
            </span>
            <div className={styles.wardActionButtons}>
              <button type="button" className={styles.wardAction} disabled={allSelected} onClick={onSelectAll}>
                全区を選択
              </button>
              <button type="button" className={styles.wardAction} disabled={noneSelected} onClick={onClearAll}>
                選択をクリア
              </button>
            </div>
          </div>
          <div className={styles.wardList} role="group" aria-labelledby="filter-ward">
            {wards.map((w) => {
              const selected = wardIds.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  className={`${styles.chip}${selected ? ` ${styles.on}` : ''}`}
                  aria-pressed={selected}
                  onClick={() => onToggle(w.id)}
                >
                  {w.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

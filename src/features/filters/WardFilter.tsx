import { useEffect, useId, useRef } from 'react';
import type { Ward } from '../../schema';
import { formatWardSummary } from './ward-summary';
import styles from './Filters.module.css';

interface Props {
  wards: Ward[];
  wardIds: string[];
  open: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  onToggle: (wardId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export function WardFilter({ wards, wardIds, open, onToggleOpen, onClose, onToggle, onSelectAll, onClearAll }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDocumentClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const allSelected = wardIds.length === wards.length;
  const noneSelected = wardIds.length === 0;
  const summary = formatWardSummary(wards, wardIds);

  return (
    <div ref={containerRef} className={styles.popoverAnchor}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.chip} ${styles.dropdownTrigger}${!allSelected ? ` ${styles.on}` : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggleOpen}
      >
        <span className={styles.triggerPrefix}>区</span> <span>{summary}</span>
        <span className={styles.caret} aria-hidden="true" />
      </button>
      <div
        id={panelId}
        className={`${styles.popoverPanel}${open ? '' : ` ${styles.popoverPanelClosed}`}`}
        aria-hidden={!open || undefined}
        inert={!open}
      >
        <div className={styles.panelActions}>
          <span className={styles.panelCount}>
            {wardIds.length} / {wards.length}区を選択中
          </span>
          <div className={styles.panelActionButtons}>
            <button type="button" className={styles.panelAction} disabled={allSelected} onClick={onSelectAll}>
              全区を選択
            </button>
            <button type="button" className={styles.panelAction} disabled={noneSelected} onClick={onClearAll}>
              選択をクリア
            </button>
          </div>
        </div>
        <div className={styles.panelList} role="group" aria-label="区">
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
    </div>
  );
}

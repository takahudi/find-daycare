import { useEffect, useId, useRef } from 'react';
import type { FacilityType } from '../../schema';
import { FACILITY_TYPES, FACILITY_TYPE_LABELS } from '../../lib/facility-labels';
import { formatFacilityTypeSummary } from './facility-type-summary';
import styles from './Filters.module.css';

const chipByFacilityType: Record<FacilityType, string> = {
  nursery: styles.nursery,
  kodomoen: styles.kodomoen,
  community: styles.community,
  kigyo: styles.kigyo,
};

interface Props {
  facilityTypes: FacilityType[];
  open: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  onToggle: (facilityType: FacilityType) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export function FacilityTypeFilter({ facilityTypes, open, onToggleOpen, onClose, onToggle, onSelectAll, onClearAll }: Props) {
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

  const allSelected = facilityTypes.length === FACILITY_TYPES.length;
  const noneSelected = facilityTypes.length === 0;
  const summary = formatFacilityTypeSummary(facilityTypes);

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
        <span className={styles.triggerPrefix}>種別</span> <span>{summary}</span>
        <span className={styles.caret} aria-hidden="true" />
      </button>
      <div
        id={panelId}
        className={`${styles.popoverPanel} ${styles.typePanel}${open ? '' : ` ${styles.popoverPanelClosed}`}`}
        aria-hidden={!open || undefined}
        inert={!open}
      >
        <div className={styles.panelActions}>
          <span className={styles.panelCount}>
            {facilityTypes.length} / {FACILITY_TYPES.length}種別を選択中
          </span>
          <div className={styles.panelActionButtons}>
            <button type="button" className={styles.panelAction} disabled={allSelected} onClick={onSelectAll}>
              すべて選択
            </button>
            <button type="button" className={styles.panelAction} disabled={noneSelected} onClick={onClearAll}>
              選択をクリア
            </button>
          </div>
        </div>
        <div className={styles.panelList} role="group" aria-label="種別">
          {FACILITY_TYPES.map((facilityType) => {
            const selected = facilityTypes.includes(facilityType);
            return (
              <button
                key={facilityType}
                type="button"
                className={`${styles.chip} ${chipByFacilityType[facilityType]}${selected ? ` ${styles.on}` : ''}`}
                aria-pressed={selected}
                onClick={() => onToggle(facilityType)}
              >
                {FACILITY_TYPE_LABELS[facilityType].filterLabel}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

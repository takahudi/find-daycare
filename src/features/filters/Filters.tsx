import { useState } from 'react';
import type { Ward } from '../../schema';
import { AGE_LABELS, AGES } from '../../lib/vacancy';
import type { useFilters } from './useFilters';
import { FacilityTypeFilter } from './FacilityTypeFilter';
import { WardFilter } from './WardFilter';
import styles from './Filters.module.css';

interface Props {
  wards: Ward[];
  state: ReturnType<typeof useFilters>;
}

export function Filters({ wards, state }: Props) {
  const {
    ages,
    wardIds,
    facilityTypes,
    onlyOpen,
    toggleWard,
    selectAllWards,
    clearWards,
    toggleAge,
    toggleFacilityType,
    selectAllFacilityTypes,
    clearFacilityTypes,
    setOnlyOpen,
  } = state;
  const [openPanel, setOpenPanel] = useState<'ward' | 'type' | null>(null);

  return (
    <section className={styles.filters} aria-label="絞り込み">
      <div className={styles.primaryRow}>
        {wards.length > 1 && (
          <WardFilter
            wards={wards}
            wardIds={wardIds}
            open={openPanel === 'ward'}
            onToggleOpen={() => setOpenPanel((current) => (current === 'ward' ? null : 'ward'))}
            onClose={() => setOpenPanel((current) => (current === 'ward' ? null : current))}
            onToggle={toggleWard}
            onSelectAll={selectAllWards}
            onClearAll={clearWards}
          />
        )}
        <FacilityTypeFilter
          facilityTypes={facilityTypes}
          open={openPanel === 'type'}
          onToggleOpen={() => setOpenPanel((current) => (current === 'type' ? null : 'type'))}
          onClose={() => setOpenPanel((current) => (current === 'type' ? null : current))}
          onToggle={toggleFacilityType}
          onSelectAll={selectAllFacilityTypes}
          onClearAll={clearFacilityTypes}
        />
        <label className={`${styles.chip} ${styles.toggleChip}${onlyOpen ? ` ${styles.on}` : ''}`}>
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          空きありのみ
        </label>
      </div>
      <div className={styles.group} role="group" aria-labelledby="filter-age">
        <span id="filter-age" className={styles.label}>
          年齢
        </span>
        {AGES.map((a) => (
          <button
            key={a}
            type="button"
            className={`${styles.chip}${ages.includes(a) ? ` ${styles.on}` : ''}`}
            aria-pressed={ages.includes(a)}
            onClick={() => toggleAge(a)}
          >
            {AGE_LABELS[a]}
          </button>
        ))}
      </div>
    </section>
  );
}

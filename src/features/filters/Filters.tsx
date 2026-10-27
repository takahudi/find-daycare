import * as v from 'valibot';
import type { Ward } from '../../schema';
import { AGE_LABELS, AGES } from '../../lib/vacancy';
import { FACILITY_TYPES, FACILITY_TYPE_LABELS } from '../../lib/facility-labels';
import { SORT_KEYS } from '../../lib/list-facilities';
import type { useFilters } from './useFilters';

const SortKeySchema = v.picklist(SORT_KEYS);

interface Props {
  wards: Ward[];
  hasHome: boolean;
  state: ReturnType<typeof useFilters>;
}

export function Filters({ wards, hasHome, state }: Props) {
  const { ages, wardIds, facilityTypes, onlyOpen, sort, toggleWard, toggleAge, toggleFacilityType, setOnlyOpen, setSort } = state;
  return (
    <section className="filters" aria-label="絞り込み">
      {wards.length > 1 && (
        <div className="filters__group" role="group" aria-labelledby="filter-ward">
          <span id="filter-ward" className="filters__label">
            区
          </span>
          {wards.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`chip${wardIds.includes(w.id) ? ' chip--on' : ''}`}
              aria-pressed={wardIds.includes(w.id)}
              onClick={() => toggleWard(w.id)}
            >
              {w.name}
            </button>
          ))}
        </div>
      )}
      <div className="filters__group" role="group" aria-labelledby="filter-age">
        <span id="filter-age" className="filters__label">
          クラス年齢
        </span>
        {AGES.map((a) => (
          <button
            key={a}
            type="button"
            className={`chip${ages.includes(a) ? ' chip--on' : ''}`}
            aria-pressed={ages.includes(a)}
            onClick={() => toggleAge(a)}
          >
            {AGE_LABELS[a]}
          </button>
        ))}
      </div>
      <div className="filters__group" role="group" aria-labelledby="filter-type">
        <span id="filter-type" className="filters__label">
          種別
        </span>
        {FACILITY_TYPES.map((facilityType) => (
          <button
            key={facilityType}
            type="button"
            className={`chip chip--${facilityType}${facilityTypes.includes(facilityType) ? ' chip--on' : ''}`}
            aria-pressed={facilityTypes.includes(facilityType)}
            onClick={() => toggleFacilityType(facilityType)}
          >
            {FACILITY_TYPE_LABELS[facilityType].filterLabel}
          </button>
        ))}
      </div>
      <div className="filters__group">
        <label className="toggle">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          空きがある施設のみ
        </label>
        <label className="sort">
          並び順
          <select
            value={sort}
            onChange={(e) => {
              const value = e.target.value;
              if (v.is(SortKeySchema, value)) setSort(value);
            }}
          >
            <option value="distance" disabled={!hasHome}>
              自宅から近い順{hasHome ? '' : '（住所を入力）'}
            </option>
            <option value="vacancy">空きが多い順</option>
            <option value="name">名前順</option>
          </select>
        </label>
      </div>
    </section>
  );
}

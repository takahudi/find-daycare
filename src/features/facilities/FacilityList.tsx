import { useId, type RefObject } from 'react';
import * as v from 'valibot';
import type { Facility } from '../../schema';
import { SORT_KEYS, type SortKey } from '../../lib/list-facilities';
import { AGE_LABELS } from '../../lib/vacancy';
import { FacilityCard } from './FacilityCard';
import styles from './FacilityList.module.css';

const SortKeySchema = v.picklist(SORT_KEYS);

interface Props {
  facilities: Facility[];
  distanceOf: (facility: Facility) => number | null;
  vacancyOf: (facility: Facility) => number;
  vacancyExpiredOf: (facility: Facility) => boolean;
  ages: number[];
  hasHome: boolean;
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
  showRank: boolean;
  selectedId: string | null;
  pinnedId?: string | null;
  pinnedRef?: RefObject<HTMLElement | null>;
  onSelect: (id: string) => void;
  onShowOnMap: (id: string) => void;
  onJumpToPinned?: (id: string) => void;
  onDismissPinned?: () => void;
}

export function FacilityList({
  facilities,
  distanceOf,
  vacancyOf,
  vacancyExpiredOf,
  ages,
  hasHome,
  sort,
  onSortChange,
  showRank,
  selectedId,
  pinnedId,
  pinnedRef,
  onSelect,
  onShowOnMap,
  onJumpToPinned,
  onDismissPinned,
}: Props) {
  const pinnedLabelId = useId();
  const openCount = facilities.filter((f) => vacancyOf(f) > 0).length;
  const pinnedIndex = pinnedId ? facilities.findIndex((f) => f.id === pinnedId) : -1;
  const pinnedFacility = pinnedIndex >= 0 ? facilities[pinnedIndex] : null;

  return (
    <>
      <div className={styles.listHeader}>
        <p className={styles.count}>
          {facilities.length}件中 <strong>{openCount}件</strong>
          に空きあり{ages.length > 0 && `（${ages.map((a) => AGE_LABELS[a]).join('・')}クラス）`}
        </p>
        <label className={styles.sort}>
          <span className="visually-hidden">並び順</span>
          <select
            value={sort}
            onChange={(e) => {
              const value = e.target.value;
              if (v.is(SortKeySchema, value)) onSortChange(value);
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
      {pinnedFacility && (
        <section ref={pinnedRef} className={styles.pinned} aria-labelledby={pinnedLabelId}>
          <div className={styles.pinnedHeader}>
            <p id={pinnedLabelId} className={styles.pinnedLabel}>
              地図で選択中の施設
            </p>
            <div className={styles.pinnedActions}>
              {pinnedIndex > 0 && onJumpToPinned && (
                <button type="button" className={styles.pinnedAction} onClick={() => onJumpToPinned(pinnedFacility.id)}>
                  一覧の位置へ移動
                </button>
              )}
              {onDismissPinned && (
                <button type="button" className={`${styles.pinnedAction} ${styles.pinnedDismiss}`} onClick={onDismissPinned}>
                  閉じる
                </button>
              )}
            </div>
          </div>
          <FacilityCard
            facility={pinnedFacility}
            vacancyExpired={vacancyExpiredOf(pinnedFacility)}
            rank={showRank ? pinnedIndex + 1 : null}
            distance={distanceOf(pinnedFacility)}
            selected={pinnedFacility.id === selectedId}
            onSelect={onSelect}
            onShowOnMap={onShowOnMap}
          />
        </section>
      )}
      <div className={styles.cards}>
        {facilities.map((f, i) => {
          if (f.id === pinnedFacility?.id) return null;
          return (
            <FacilityCard
              key={f.id}
              facility={f}
              vacancyExpired={vacancyExpiredOf(f)}
              rank={showRank ? i + 1 : null}
              distance={distanceOf(f)}
              selected={f.id === selectedId}
              onSelect={onSelect}
              onShowOnMap={onShowOnMap}
            />
          );
        })}
        {facilities.length === 0 && <p className={styles.empty}>条件に合う施設がありません。絞り込みを変更してください。</p>}
      </div>
    </>
  );
}

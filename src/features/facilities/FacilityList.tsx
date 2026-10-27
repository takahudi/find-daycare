import type { Facility } from '../../schema';
import { AGE_LABELS } from '../../lib/vacancy';
import { FacilityCard } from './FacilityCard';

interface Props {
  facilities: Facility[];
  distanceOf: (facility: Facility) => number | null;
  vacancyOf: (facility: Facility) => number;
  ages: number[];
  showRank: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onShowOnMap: (id: string) => void;
}

export function FacilityList({ facilities, distanceOf, vacancyOf, ages, showRank, selectedId, onSelect, onShowOnMap }: Props) {
  const openCount = facilities.filter((f) => vacancyOf(f) > 0).length;
  return (
    <>
      <p className="list__count">
        {facilities.length}件中 <strong>{openCount}件</strong>
        に空きあり{ages.length > 0 && `（${ages.map((a) => AGE_LABELS[a]).join('・')}クラス）`}
      </p>
      <div className="cards">
        {facilities.map((f, i) => (
          <FacilityCard
            key={f.id}
            facility={f}
            rank={showRank ? i + 1 : null}
            distance={distanceOf(f)}
            highlightAges={ages}
            selected={f.id === selectedId}
            onSelect={() => onSelect(f.id)}
            onShowOnMap={() => onShowOnMap(f.id)}
          />
        ))}
        {facilities.length === 0 && <p className="empty">条件に合う施設がありません。絞り込みを変更してください。</p>}
      </div>
    </>
  );
}

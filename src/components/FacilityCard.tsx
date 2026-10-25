import type { Ref } from 'react';
import type { Facility } from '../schema';
import { formatDistance, walkMinutes } from '../lib/geo';
import { AGE_LABELS, vacancyCount } from '../lib/vacancy';
import { FACILITY_TYPE_LABELS, LICENSING_LABELS } from '../lib/facility-labels';

interface Props {
  facility: Facility;
  rank: number | null;
  distance: number | null;
  highlightAges: number[];
  selected: boolean;
  onSelect: () => void;
  onShowOnMap: () => void;
  ref?: Ref<HTMLElement>;
}

export function FacilityCard({ facility: f, rank, distance, highlightAges, selected, onSelect, onShowOnMap, ref }: Props) {
  const total = vacancyCount(f, []);
  const shared = f.sharedVacancy;
  const typeLabel = FACILITY_TYPE_LABELS[f.facilityType].label;
  const showDetailType = f.detailType && f.detailType !== typeLabel;

  return (
    <article
      ref={ref}
      className={`card${selected ? ' card--selected' : ''}`}
      aria-current={selected || undefined}
      onClick={onSelect}
    >
      <header className="card__head">
        <div className="card__badges">
          <span className="badge badge--ward">{f.wardName}</span>
          <span className={`badge badge--${f.facilityType}`}>{typeLabel}</span>
          {f.licensing === 'unlicensed' && <span className="badge badge--unlicensed">{LICENSING_LABELS[f.licensing]}</span>}
          {f.ownership && <span className="badge badge--plain">{f.ownership}</span>}
          {showDetailType && <span className="badge badge--plain">{f.detailType}</span>}
        </div>
        <h2 className="card__title">
          {rank !== null && <span className="card__rank">{rank}</span>}
          {f.name}
        </h2>
        {f.kana && <p className="card__kana">{f.kana}</p>}
        {f.licensing === 'unlicensed' && (
          <p className="card__caution">
            認可外保育施設です。申込みは区役所ではなく施設との直接契約です
            {f.facilityType === 'kigyo' && '（空き人数は地域枠）'}。
          </p>
        )}
        {distance !== null && (
          <p className="card__distance">
            🏠 自宅から <strong>{formatDistance(distance)}</strong>
            <span className="muted">（直線・徒歩約{walkMinutes(distance)}分）</span>
          </p>
        )}
      </header>

      <div className="vacancy" role="table" aria-label="年齢別の空き人数">
        <div role="row" className="vacancy__row">
          {f.vacancies.map((v, age) => {
            // 共有枠（例: 1・2歳あわせて1人）は1つのセルにまとめて表示する
            const group = shared?.ages.includes(age) ? shared.ages : [age];
            if (group[0] !== age) return null;
            const label = group.length > 1 ? `${group.join('・')}歳` : AGE_LABELS[age];
            const state = v === null ? 'na' : v > 0 ? 'open' : 'full';
            const focus = group.some((a) => highlightAges.includes(a));
            return (
              <div
                key={age}
                role="cell"
                className={`vacancy__cell vacancy__cell--${state}${focus ? ' vacancy__cell--focus' : ''}`}
                style={group.length > 1 ? { gridColumn: `span ${group.length}` } : undefined}
                title={v === null ? `${label}: 受入れ対象外` : `${label}: 空き${v}人${group.length > 1 ? '（共有）' : ''}`}
              >
                <span className="vacancy__age">{label}</span>
                <span className="vacancy__num">{v === null ? '—' : v > 0 ? v : '×'}</span>
              </div>
            );
          })}
        </div>
        <p className="vacancy__summary">
          {total > 0 ? <span className="ok">空きあり 計{total}人</span> : <span className="ng">現在空きなし</span>}
        </p>
      </div>

      <dl className="card__facts">
        {f.capacity && (
          <>
            <dt>定員</dt>
            <dd>{f.capacity.total}人</dd>
          </>
        )}
        {f.hours && (
          <>
            <dt>開園</dt>
            <dd>
              平日 {f.hours.weekday}
              {f.hours.saturday && <> ／ 土 {f.hours.saturday}</>}
              {f.hours.holiday && <> ／ 日祝 {f.hours.holiday}</>}
            </dd>
          </>
        )}
        <dt>住所</dt>
        <dd>
          {f.postalCode && <>〒{f.postalCode} </>}
          {f.address}
        </dd>
        <dt>電話</dt>
        <dd>
          <a href={`tel:${f.phone}`} onClick={(e) => e.stopPropagation()}>
            {f.phone}
          </a>
        </dd>
        {f.operator && (
          <>
            <dt>運営</dt>
            <dd>{f.operator}</dd>
          </>
        )}
      </dl>

      {f.services.length > 0 && (
        <ul className="card__tags">
          {f.services.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {f.note && <p className="card__note">{f.note}</p>}

      <footer className="card__links" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="card__map-btn" onClick={onShowOnMap}>
          📍 地図で見る
        </button>
        {f.website && (
          <a href={f.website} target="_blank" rel="noreferrer" title={f.websiteLabel ?? undefined}>
            公式サイト ↗
          </a>
        )}
        {f.infoPdfUrl && (
          <a href={f.infoPdfUrl} target="_blank" rel="noreferrer">
            {f.infoPdfLabel} ↗
          </a>
        )}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${f.name} ${f.address}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Googleマップ ↗
        </a>
      </footer>
    </article>
  );
}

import { useId } from 'react';
import type { Facility, FacilityType } from '../../schema';
import { formatDistance, walkMinutes } from '../../lib/geo';
import { AGE_LABELS, vacancyCount } from '../../lib/vacancy';
import { FACILITY_TYPE_LABELS, LICENSING_LABELS } from '../../lib/facility-labels';
import { FACILITY_ID_ATTRIBUTE } from './scroll-to-facility';
import styles from './FacilityCard.module.css';

const badgeByFacilityType: Record<FacilityType, string> = {
  nursery: styles.badgeNursery,
  kodomoen: styles.badgeKodomoen,
  community: styles.badgeCommunity,
  kigyo: styles.badgeKigyo,
};

const cellByVacancyState: Record<'open' | 'full' | 'na', string> = {
  open: styles.cellOpen,
  full: styles.cellFull,
  na: styles.cellNa,
};

interface Props {
  facility: Facility;
  rank: number | null;
  distance: number | null;
  highlightAges: number[];
  selected: boolean;
  onSelect: () => void;
  onShowOnMap: () => void;
}

export function FacilityCard({ facility: f, rank, distance, highlightAges, selected, onSelect, onShowOnMap }: Props) {
  const nameId = useId();
  const total = vacancyCount(f, []);
  const shared = f.sharedVacancy;
  const typeLabel = FACILITY_TYPE_LABELS[f.facilityType].label;
  const showDetailType = f.detailType && f.detailType !== typeLabel;

  return (
    <article
      className={`${styles.card}${selected ? ` ${styles.cardSelected}` : ''}`}
      aria-labelledby={nameId}
      {...{ [FACILITY_ID_ATTRIBUTE]: f.id }}
      aria-current={selected || undefined}
      onClick={onSelect}
    >
      <header className={styles.cardHead}>
        <ul className={styles.cardBadges} role="list" aria-label="分類">
          <li className={`${styles.badge} ${styles.badgeWard}`}>{f.wardName}</li>
          <li className={`${styles.badge} ${badgeByFacilityType[f.facilityType]}`}>{typeLabel}</li>
          {f.licensing === 'unlicensed' && (
            <li className={`${styles.badge} ${styles.badgeUnlicensed}`}>{LICENSING_LABELS[f.licensing]}</li>
          )}
          {f.ownership && <li className={`${styles.badge} ${styles.badgePlain}`}>{f.ownership}</li>}
          {showDetailType && <li className={`${styles.badge} ${styles.badgePlain}`}>{f.detailType}</li>}
        </ul>
        <h2 id={nameId} className={styles.cardTitle}>
          {rank !== null && <span className={styles.cardRank}>{rank}</span>}
          {f.name}
        </h2>
        {f.kana && <p className={styles.cardKana}>{f.kana}</p>}
        {f.licensing === 'unlicensed' && (
          <p className={styles.cardCaution}>
            認可外保育施設です。申込みは区役所ではなく施設との直接契約です
            {f.facilityType === 'kigyo' && '（空き人数は地域枠）'}。
          </p>
        )}
        {distance !== null && (
          <p className={styles.cardDistance}>
            🏠 自宅から <strong>{formatDistance(distance)}</strong>
            <span className={styles.walkTime}>（直線・徒歩約{walkMinutes(distance)}分）</span>
          </p>
        )}
      </header>

      <div role="table" aria-label="年齢別の空き人数">
        <div role="row" className={styles.vacancyRow}>
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
                className={`${styles.vacancyCell} ${cellByVacancyState[state]}${focus ? ` ${styles.cellFocus}` : ''}`}
                style={group.length > 1 ? { gridColumn: `span ${group.length}` } : undefined}
                title={v === null ? `${label}: 受入れ対象外` : `${label}: 空き${v}人${group.length > 1 ? '（共有）' : ''}`}
              >
                <span className={styles.vacancyAge}>{label}</span>
                <span className={styles.vacancyNum}>{v === null ? '—' : v > 0 ? v : '×'}</span>
              </div>
            );
          })}
        </div>
        <p className={styles.vacancySummary}>
          {total > 0 ? (
            <span className={styles.summaryOpen}>空きあり 計{total}人</span>
          ) : (
            <span className={styles.summaryFull}>現在空きなし</span>
          )}
        </p>
      </div>

      <dl className={styles.cardFacts}>
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
        <ul className={styles.cardTags}>
          {f.services.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {f.note && <p className={styles.cardNote}>{f.note}</p>}

      <footer className={styles.cardLinks} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.cardMapBtn} onClick={onShowOnMap}>
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

import { useMemo, useState } from 'react';
import * as v from 'valibot';
import type { Dataset, FacilityType } from './schema';
import { summarizeDataset, type DatasetSummary } from './lib/dataset-summary';
import { FacilityCard } from './components/FacilityCard';
import { MapView } from './components/MapView';
import { useHome, type HomeChoice } from './features/home/useHome';
import { HomeForm } from './features/home/HomeForm';
import { listFacilities, type SortKey } from './lib/list-facilities';
import { AGE_LABELS, AGES } from './lib/vacancy';
import { FACILITY_TYPES, FACILITY_TYPE_LABELS, LICENSING_LABELS } from './lib/facility-labels';

const SortKeySchema = v.picklist(['distance', 'vacancy', 'name']);

export default function App({ data }: { data: Dataset }) {
  const summary = summarizeDataset(data);
  const { wardNames, title, asOfLabels, kigyoAsOfText } = summary;
  // join を後ろへ延ばすと集計の可変スコープがフックをまたぎ、キャッシュされない
  const wardTitle = `対象: ${wardNames.join('・')}`;
  const [ages, setAges] = useState<number[]>([]);
  const [wardIds, setWardIds] = useState<string[]>(data.wards.map((w) => w.id));
  const [facilityTypes, setFacilityTypes] = useState<FacilityType[]>([...FACILITY_TYPES]);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const homeState = useHome(wardNames);
  const { home } = homeState;
  const [sort, setSort] = useState<SortKey>(home ? 'distance' : 'vacancy');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const onHomeChosen = (source: HomeChoice) => {
    setSort('distance');
    if (source === 'search') setSelectedId(null);
  };
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');

  // 一覧の計算と JSX の可変スコープが結合するため、分割まではキャッシュ境界を明示する
  const { visible, distanceOf, vacancyOf } = useMemo(() => {
    return listFacilities(data.facilities, { ages, wardIds, facilityTypes, onlyOpen, sort }, home);
  }, [data.facilities, home, wardIds, facilityTypes, ages, onlyOpen, sort]);

  const openCount = visible.filter((f) => vacancyOf(f) > 0).length;

  const select = (id: string, from: 'list' | 'map') => {
    setSelectedId(id);
    if (from === 'map') {
      document
        .querySelector<HTMLElement>(`[data-facility-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  return (
    <div className={`app app--${mobileView}`}>
      <header className="topbar">
        <div className="topbar__title">
          <h1 title={wardTitle}>
            {title}の保育施設 <span>空き状況マップ</span>
          </h1>
          <p className="topbar__asof">
            空き情報：
            {asOfLabels.length === 1 ? (
              <strong>{asOfLabels[0]}</strong>
            ) : (
              data.wards.map((w) => (
                <span key={w.id}>
                  {w.name} <strong>{w.vacancyAsOf}</strong>（{w.vacancyFor}）{' '}
                </span>
              ))
            )}
            {kigyoAsOfText && <>・企業主導型（地域枠）は{kigyoAsOfText}</>}・出典 大阪市・各区役所
          </p>
        </div>

        <HomeForm state={homeState} onHomeChosen={onHomeChosen} />
      </header>

      <section className="filters" aria-label="絞り込み">
        {data.wards.length > 1 && (
          <div className="filters__group" role="group" aria-labelledby="filter-ward">
            <span id="filter-ward" className="filters__label">
              区
            </span>
            {data.wards.map((w) => (
              <button
                key={w.id}
                type="button"
                className={`chip${wardIds.includes(w.id) ? ' chip--on' : ''}`}
                aria-pressed={wardIds.includes(w.id)}
                onClick={() => setWardIds((cur) => toggle(cur, w.id))}
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
              onClick={() => setAges((cur) => toggle(cur, a).sort((x, y) => x - y))}
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
              onClick={() => setFacilityTypes((cur) => toggle(cur, facilityType))}
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
              <option value="distance" disabled={!home}>
                自宅から近い順{home ? '' : '（住所を入力）'}
              </option>
              <option value="vacancy">空きが多い順</option>
              <option value="name">名前順</option>
            </select>
          </label>
        </div>
      </section>

      <nav className="mobile-tabs" aria-label="表示切替">
        <button type="button" aria-pressed={mobileView === 'list'} onClick={() => setMobileView('list')}>
          リスト
        </button>
        <button type="button" aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>
          地図
        </button>
      </nav>

      <main className="layout">
        <section className="list" aria-label="施設一覧">
          <p className="list__count">
            {visible.length}件中 <strong>{openCount}件</strong>
            に空きあり{ages.length > 0 && `（${ages.map((a) => AGE_LABELS[a]).join('・')}クラス）`}
          </p>
          <div className="cards">
            {visible.map((f, i) => (
              <FacilityCard
                key={f.id}
                facility={f}
                rank={sort === 'distance' && home ? i + 1 : null}
                distance={distanceOf(f)}
                highlightAges={ages}
                selected={f.id === selectedId}
                onSelect={() => select(f.id, 'list')}
                onShowOnMap={() => {
                  select(f.id, 'list');
                  setMobileView('map');
                }}
              />
            ))}
            {visible.length === 0 && <p className="empty">条件に合う施設がありません。絞り込みを変更してください。</p>}
          </div>
          <Sources data={data} summary={summary} />
        </section>

        <section className="map-pane" aria-label="地図">
          <MapView
            facilities={visible}
            vacancyOf={vacancyOf}
            distanceOf={distanceOf}
            home={home}
            selectedId={selectedId}
            onSelect={(id) => select(id, 'map')}
          />
          <div className="legend" role="group" aria-label="地図の凡例">
            <span>
              <i className="pin pin--open" aria-hidden="true">
                2
              </i>{' '}
              空きあり（人数）
            </span>
            <span>
              <i className="pin pin--full" aria-hidden="true">
                ×
              </i>{' '}
              空きなし
            </span>
            <span>
              <i className="pin pin--open pin--unlicensed" aria-hidden="true">
                1
              </i>{' '}
              {LICENSING_LABELS.unlicensed}
            </span>
            {home && (
              <span>
                <i className="pin pin--home" aria-hidden="true">
                  家
                </i>{' '}
                自宅
              </span>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Sources({ data, summary: { wardNames, asOfLabels } }: { data: Dataset; summary: DatasetSummary }) {
  return (
    <footer className="sources">
      <p>
        空き人数は{asOfLabels.join('／')}の情報です。日々変動するため、利用申込みの前に必ず各区の保健福祉センター（
        {wardNames.map((n) => `${n}役所`).join('・')}）または各施設へご確認ください。距離は直線距離です。
      </p>
      <p>
        企業主導型保育事業所は認可外保育施設です。利用は施設と保護者の直接契約で、区役所の利用調整の対象外です。利用料・対象年齢・利用条件は施設ごとに異なるため、見学のうえ施設へ直接お問い合わせください（空き人数は地域枠の数）。
      </p>
      <ul>
        {[...data.wards.flatMap((w) => w.sources), ...data.commonSources].map((s) => (
          <li key={s.url + s.label}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </li>
        ))}
        <li>
          住所検索：
          <a href="https://msearch.gsi.go.jp/address-search/AddressSearch" target="_blank" rel="noreferrer">
            国土地理院 住所検索API
          </a>
          ／ 地図：国土地理院 地理院タイル（淡色地図）
        </li>
      </ul>
    </footer>
  );
}

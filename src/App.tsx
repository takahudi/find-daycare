import { useMemo, useState } from 'react';
import type { Dataset } from './schema';
import { summarizeDataset, type DatasetSummary } from './lib/dataset-summary';
import { listFacilities } from './lib/list-facilities';
import { AGE_LABELS } from './lib/vacancy';
import { LICENSING_LABELS } from './lib/facility-labels';
import { useFilters } from './features/filters/useFilters';
import { Filters } from './features/filters/Filters';
import { useHome, type HomeChoice } from './features/home/useHome';
import { HomeForm } from './features/home/HomeForm';
import { scrollToFacility } from './features/facilities/scroll-to-facility';
import { FacilityCard } from './features/facilities/FacilityCard';
import { MapView } from './features/map/MapView';

export default function App({ data }: { data: Dataset }) {
  const summary = summarizeDataset(data);
  const { wardNames, title, asOfLabels, kigyoAsOfText } = summary;
  // join を後ろへ延ばすと集計の可変スコープがフックをまたぎ、キャッシュされない
  const wardTitle = `対象: ${wardNames.join('・')}`;
  const homeState = useHome(wardNames);
  const { home } = homeState;
  const filters = useFilters({ wardIds: data.wards.map((w) => w.id), sort: home ? 'distance' : 'vacancy' });
  const { ages, wardIds, facilityTypes, onlyOpen, sort, setSort } = filters;
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
      scrollToFacility(id);
    }
  };

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

      <Filters wards={data.wards} hasHome={!!home} state={filters} />

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

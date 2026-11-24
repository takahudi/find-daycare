import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useSelectedFacility } from '../features/facilities/useSelectedFacility';
import type { Dataset, Facility } from '../schema';
import { isFacilityVacancyExpired } from '../lib/vacancy-expiry';
import { summarizeDataset } from '../lib/dataset-summary';
import { listFacilities } from '../lib/list-facilities';
import { DatasetHeading } from '../features/dataset/DatasetHeading';
import { useExpiredWards } from '../features/dataset/useExpiredWards';
import { Sources } from '../features/dataset/Sources';
import { FacilityList } from '../features/facilities/FacilityList';
import { scrollToFacility } from '../features/facilities/scroll-to-facility';
import { useFilters } from '../features/filters/useFilters';
import { Filters } from '../features/filters/Filters';
import { useHome, type HomeChoice } from '../features/home/useHome';
import { HomeForm } from '../features/home/HomeForm';
import { MapLegend } from '../features/map/MapLegend';
import { useMobileHeaderScroll } from './useMobileHeaderScroll';
import styles from './App.module.css';

type MapViewComponent = typeof import('../features/map/MapView').MapView;

let loadedMapView: MapViewComponent | null = null;
let mapViewPromise: Promise<MapViewComponent> | null = null;

function loadMapView(): Promise<MapViewComponent> {
  if (!mapViewPromise) {
    mapViewPromise = import('../features/map/MapView').then((module) => {
      loadedMapView = module.MapView;
      return loadedMapView;
    });
  }
  return mapViewPromise;
}

if (!window.matchMedia('(max-width: 860px)').matches) {
  void loadMapView();
}

export default function App({ data }: { data: Dataset }) {
  const expiredWards = useExpiredWards(data.wards);
  const expiredWardIds = new Set(expiredWards.map((ward) => ward.id));
  const vacancyExpiredOf = (facility: Facility) => isFacilityVacancyExpired(facility, expiredWardIds);
  const summary = summarizeDataset(data);
  const { wardNames } = summary;
  const homeState = useHome(wardNames);
  const { home } = homeState;
  const filters = useFilters({ wardIds: data.wards.map((w) => w.id), sort: home ? 'distance' : 'vacancy' });
  const { ages, wardIds, facilityTypes, onlyOpen, sort, setSort, followDefaultSort } = filters;
  const onHomeChosen = (source: HomeChoice) => {
    followDefaultSort();
    if (source === 'search') setSelectedId(null);
  };
  const [mobileTab, setMobileTab] = useState<'list' | 'map'>('list');
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [mapActivated, setMapActivated] = useState(() => !window.matchMedia('(max-width: 860px)').matches);
  const switchMobileView = (next: 'list' | 'map') => {
    setMobileTab(next);
    if (next === 'list') {
      startTransition(() => setMobileView('list'));
    } else {
      setMapActivated(true);
      setMobileView('map');
    }
  };
  const appRef = useRef<HTMLDivElement>(null);
  const mobileTabsRef = useRef<HTMLElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const [MapView, setMapView] = useState<MapViewComponent | null>(() => (mapActivated ? loadedMapView : null));
  useEffect(() => {
    if (mapActivated) return undefined;
    const media = window.matchMedia('(max-width: 860px)');
    const onChange = () => {
      if (!media.matches) setMapActivated(true);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mapActivated]);
  useEffect(() => {
    if (!mapActivated || MapView) return undefined;
    let active = true;
    void loadMapView().then((component) => {
      if (active) setMapView(() => component);
    });
    return () => {
      active = false;
    };
  }, [mapActivated, MapView]);

  const { visible, distanceOf, vacancyOf } = listFacilities(
    data.facilities,
    { ages, wardIds, facilityTypes, onlyOpen, sort },
    home,
  );
  const { headerCollapsed, canToggleHeader, toggleHeader } = useMobileHeaderScroll(
    appRef,
    mobileTabsRef,
    mobileView,
    visible.length,
  );

  const { selectedId, setSelectedId } = useSelectedFacility(
    data.facilities.map((facility) => facility.id),
    visible.map((facility) => facility.id),
  );
  const scrollToSelected = useEffectEvent(() => {
    if (selectedId) scrollToFacility(selectedId);
  });
  useEffect(() => {
    // カード操作では表示位置を変えず、読み込み時とモバイルで地図からリストへ戻ったときだけ選択施設へ移動する。
    if (mobileView === 'list') scrollToSelected();
  }, [mobileView]);

  const select = (id: string, from: 'list' | 'map') => {
    setSelectedId(id);
    if (from === 'map') {
      scrollToFacility(id);
    }
  };

  return (
    <div ref={appRef} className={`${styles.app} ${mobileView === 'list' ? styles.listView : styles.mapView}`}>
      <header className={styles.topbar}>
        <DatasetHeading data={data} summary={summary} expiredWards={expiredWards} />

        <HomeForm state={homeState} onHomeChosen={onHomeChosen} />
      </header>

      <Filters wards={data.wards} state={filters} overlayPanelsOnMobile={mobileView === 'map'} />

      <nav ref={mobileTabsRef} className={styles.mobileTabs} aria-label="表示切替">
        <button
          type="button"
          className={styles.mobileTab}
          aria-pressed={mobileTab === 'list'}
          onClick={() => switchMobileView('list')}
        >
          リスト
        </button>
        <button
          type="button"
          className={styles.mobileTab}
          aria-pressed={mobileTab === 'map'}
          onClick={() => switchMobileView('map')}
        >
          地図
        </button>
        <button
          type="button"
          className={styles.headerToggle}
          aria-expanded={!headerCollapsed}
          aria-label={headerCollapsed ? '絞り込みとヘッダーを表示' : '絞り込みとヘッダーを隠す'}
          disabled={!canToggleHeader}
          onClick={toggleHeader}
        >
          <span>絞り込み</span>
          <span className={styles.headerToggleCaret} aria-hidden="true" />
        </button>
      </nav>

      <main className={styles.layout}>
        <section className={styles.list} aria-label="施設一覧">
          <FacilityList
            facilities={visible}
            distanceOf={distanceOf}
            vacancyOf={vacancyOf}
            vacancyExpiredOf={vacancyExpiredOf}
            ages={ages}
            hasHome={!!home}
            sort={sort}
            onSortChange={setSort}
            showRank={sort === 'distance' && !!home}
            selectedId={selectedId}
            onSelect={(id) => select(id, 'list')}
            onShowOnMap={(id) => {
              select(id, 'list');
              switchMobileView('map');
            }}
          />
          <Sources data={data} summary={summary} />
        </section>

        <section className={styles.mapPane} aria-label="地図">
          {MapView && (
            <MapView
              facilities={visible}
              allFacilities={data.facilities}
              vacancyOf={vacancyOf}
              vacancyExpiredOf={vacancyExpiredOf}
              distanceOf={distanceOf}
              home={home}
              selectedId={selectedId}
              mapShown={mobileView === 'map'}
              legendRef={legendRef}
              onSelect={(id) => select(id, 'map')}
            />
          )}
          <MapLegend ref={legendRef} hasHome={!!home} />
        </section>
      </main>
    </div>
  );
}

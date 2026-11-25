import { startTransition, useEffect, useEffectEvent, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSelectedFacility } from '../features/facilities/useSelectedFacility';
import type { Dataset, Facility } from '../schema';
import { isFacilityVacancyExpired } from '../lib/vacancy-expiry';
import { summarizeDataset } from '../lib/dataset-summary';
import { listFacilities } from '../lib/list-facilities';
import { DatasetHeading } from '../features/dataset/DatasetHeading';
import { useExpiredWards } from '../features/dataset/useExpiredWards';
import { Sources } from '../features/dataset/Sources';
import { FacilityList } from '../features/facilities/FacilityList';
import { FACILITY_ID_ATTRIBUTE, scrollToFacility } from '../features/facilities/scroll-to-facility';
import { useFilters } from '../features/filters/useFilters';
import { Filters } from '../features/filters/Filters';
import { useHome, type HomeChoice } from '../features/home/useHome';
import { HomeForm } from '../features/home/HomeForm';
import { MapLegend } from '../features/map/MapLegend';
import { ScrollToTopButton } from './ScrollToTopButton';
import { useMobileBarHeight } from './useMobileBarHeight';
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
    if (source === 'search') deselect();
  };
  const [mobileTab, setMobileTab] = useState<'list' | 'map'>('list');
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 860px)').matches);
  const [mapActivated, setMapActivated] = useState(() => !window.matchMedia('(max-width: 860px)').matches);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
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
  const listRef = useRef<HTMLElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLElement>(null);
  const [MapView, setMapView] = useState<MapViewComponent | null>(() => (mapActivated ? loadedMapView : null));
  useEffect(() => {
    const media = window.matchMedia('(max-width: 860px)');
    const onChange = () => {
      setIsMobile(media.matches);
      if (!media.matches) setMapActivated(true);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
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
  useMobileBarHeight(appRef, mobileTabsRef);

  const { selectedId, setSelectedId } = useSelectedFacility(
    data.facilities.map((facility) => facility.id),
    visible.map((facility) => facility.id),
  );
  const activePinnedId = isMobile && pinnedId !== null && pinnedId === selectedId ? pinnedId : null;
  const scrollToSelected = useEffectEvent(() => {
    if (selectedId) scrollToFacility(selectedId);
  });
  useEffect(() => {
    // 初期 URL の指定施設だけ表示位置へ移動する。モバイルで地図から戻ったときは先頭ピン留めで見せ、スクロール位置を維持する。
    scrollToSelected();
  }, []);

  const unpinKeepingCardPosition = (anchorId: string) => {
    const pinned = pinnedRef.current;
    const tabs = mobileTabsRef.current;
    const anchor = document.querySelector<HTMLElement>(`[${FACILITY_ID_ATTRIBUTE}="${CSS.escape(anchorId)}"]`);
    const pinnedRect = pinned?.getBoundingClientRect();
    const tabsBottom = tabs ? tabs.getBoundingClientRect().bottom : 0;
    const beforeTop = anchor?.getBoundingClientRect().top;
    if (!pinned || !pinnedRect || !anchor || beforeTop === undefined || pinnedRect.bottom > tabsBottom) {
      setPinnedId(null);
      return;
    }
    const pinnedMargin = Number.parseFloat(getComputedStyle(pinned).marginBottom) || 0;
    const pinnedHeight = pinnedRect.height + pinnedMargin;
    // ブラウザの scroll anchoring と手動補正が二重に効かないよう、このフレームだけ無効化して自前で位置を保つ。
    const rootStyle = document.documentElement.style;
    const previousOverflowAnchor = rootStyle.overflowAnchor;
    rootStyle.overflowAnchor = 'none';
    flushSync(() => setPinnedId(null));
    // 先にピン留め領域の高さぶん戻してから差分を合わせ、周辺カードの content-visibility 再ロックを避ける。
    if (pinnedHeight > 0) window.scrollBy(0, -pinnedHeight);
    const align = () => {
      const delta = anchor.getBoundingClientRect().top - beforeTop;
      if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
    };
    align();
    requestAnimationFrame(() => {
      align();
      requestAnimationFrame(() => {
        rootStyle.overflowAnchor = previousOverflowAnchor;
      });
    });
  };

  const deselect = () => {
    setSelectedId(null);
    setPinnedId(null);
  };

  const select = (id: string, from: 'list' | 'map') => {
    setSelectedId(id);
    if (from === 'map') {
      if (isMobile) {
        setPinnedId(id);
      } else {
        setPinnedId(null);
        scrollToFacility(id);
      }
    } else if (activePinnedId && id !== activePinnedId) {
      unpinKeepingCardPosition(id);
    }
  };

  const jumpToPinned = (id: string) => {
    flushSync(() => setPinnedId(null));
    scrollToFacility(id);
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
      </nav>

      <main className={styles.layout}>
        <div className={styles.listPane}>
          <section ref={listRef} className={styles.list} aria-label="施設一覧">
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
              pinnedId={activePinnedId}
              pinnedRef={pinnedRef}
              onSelect={(id) => select(id, 'list')}
              onShowOnMap={(id) => {
                select(id, 'list');
                switchMobileView('map');
              }}
              onJumpToPinned={jumpToPinned}
              onDismissPinned={() => setPinnedId(null)}
            />
            <Sources data={data} summary={summary} />
          </section>
          <ScrollToTopButton listRef={listRef} mobileView={mobileView} />
        </div>

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
              onDeselect={deselect}
            />
          )}
          <MapLegend ref={legendRef} hasHome={!!home} />
        </section>
      </main>
    </div>
  );
}

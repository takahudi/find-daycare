import { useEffect, useState } from 'react';
import { useSelectedFacility } from '../features/facilities/useSelectedFacility';
import type { Dataset } from '../schema';
import { summarizeDataset } from '../lib/dataset-summary';
import { listFacilities } from '../lib/list-facilities';
import { DatasetHeading } from '../features/dataset/DatasetHeading';
import { Sources } from '../features/dataset/Sources';
import { FacilityList } from '../features/facilities/FacilityList';
import { scrollToFacility } from '../features/facilities/scroll-to-facility';
import { useFilters } from '../features/filters/useFilters';
import { Filters } from '../features/filters/Filters';
import { useHome, type HomeChoice } from '../features/home/useHome';
import { HomeForm } from '../features/home/HomeForm';
import { MapView } from '../features/map/MapView';
import { MapLegend } from '../features/map/MapLegend';
import styles from './App.module.css';

export default function App({ data }: { data: Dataset }) {
  const summary = summarizeDataset(data);
  const { wardNames } = summary;
  const homeState = useHome(wardNames);
  const { home } = homeState;
  const filters = useFilters({ wardIds: data.wards.map((w) => w.id), sort: home ? 'distance' : 'vacancy' });
  const { ages, wardIds, facilityTypes, onlyOpen, sort, followDefaultSort } = filters;
  const onHomeChosen = (source: HomeChoice) => {
    followDefaultSort();
    if (source === 'search') setSelectedId(null);
  };
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');

  const { visible, distanceOf, vacancyOf } = listFacilities(
    data.facilities,
    { ages, wardIds, facilityTypes, onlyOpen, sort },
    home,
  );

  const { selectedId, setSelectedId } = useSelectedFacility(
    data.facilities.map((facility) => facility.id),
    visible.map((facility) => facility.id),
  );
  const [initialSelectedId] = useState(selectedId);
  useEffect(() => {
    // カード操作では表示位置を変えず、読み込み時に選択されていた施設だけに移動する。
    if (initialSelectedId) scrollToFacility(initialSelectedId);
  }, [initialSelectedId]);

  const select = (id: string, from: 'list' | 'map') => {
    setSelectedId(id);
    if (from === 'map') {
      scrollToFacility(id);
    }
  };

  return (
    <div className={`${styles.app} ${mobileView === 'list' ? styles.listView : styles.mapView}`}>
      <header className={styles.topbar}>
        <DatasetHeading data={data} summary={summary} />

        <HomeForm state={homeState} onHomeChosen={onHomeChosen} statusClassName={styles.homeStatus} />
      </header>

      <Filters wards={data.wards} hasHome={!!home} state={filters} />

      <nav className={styles.mobileTabs} aria-label="表示切替">
        <button type="button" aria-pressed={mobileView === 'list'} onClick={() => setMobileView('list')}>
          リスト
        </button>
        <button type="button" aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>
          地図
        </button>
      </nav>

      <main className={styles.layout}>
        <section className={styles.list} aria-label="施設一覧">
          <FacilityList
            facilities={visible}
            distanceOf={distanceOf}
            vacancyOf={vacancyOf}
            ages={ages}
            showRank={sort === 'distance' && !!home}
            selectedId={selectedId}
            onSelect={(id) => select(id, 'list')}
            onShowOnMap={(id) => {
              select(id, 'list');
              setMobileView('map');
            }}
          />
          <Sources data={data} summary={summary} />
        </section>

        <section className={styles.mapPane} aria-label="地図">
          <MapView
            facilities={visible}
            allFacilities={data.facilities}
            vacancyOf={vacancyOf}
            distanceOf={distanceOf}
            home={home}
            selectedId={selectedId}
            onSelect={(id) => select(id, 'map')}
          />
          <MapLegend hasHome={!!home} />
        </section>
      </main>
    </div>
  );
}

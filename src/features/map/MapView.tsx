import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import MapGL, { AttributionControl, NavigationControl } from 'react-map-gl/maplibre';
import { useTheme, type Theme } from '../../app/theme';
import type { Facility, Home } from '../../schema';
import { formatDistance } from '../../lib/geo';
import { AGE_LABELS } from '../../lib/vacancy';
import { FACILITY_TYPE_LABELS, LICENSING_LABELS } from '../../lib/facility-labels';
import { VacancyExpiryBadge } from '../dataset/VacancyExpiry';
import { MapController } from './MapController';
import { HomeControl } from './HomeControl';
import { FacilityPopup } from './FacilityPopup';
import { boundsFor } from './map-bounds';
import { createMapStyle } from './map-style';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from './MapView.module.css';
import { PinOverlay } from './PinOverlay';

maplibregl.setWorkerUrl(workerUrl);
maplibregl.prewarm();
const mapStyles: Partial<Record<Theme, ReturnType<typeof createMapStyle>>> = {};
function mapStyleFor(theme: Theme) {
  let style = mapStyles[theme];
  if (!style) {
    style = createMapStyle(window.location.origin, theme);
    mapStyles[theme] = style;
  }
  return style;
}
// Static Assets は @ を正規化するが、Vite は %40 を解決しないため、本番配信だけ書き換える。
const transformRequest: maplibregl.RequestTransformFunction = (url) => ({
  url: import.meta.env.DEV ? url : url.replace('@2x.', '%402x.'),
});

interface Props {
  facilities: Facility[];
  allFacilities: Facility[];
  vacancyOf: (f: Facility) => number;
  vacancyExpiredOf: (f: Facility) => boolean;
  distanceOf: (f: Facility) => number | null;
  home: Home | null;
  selectedId: string | null;
  mapShown: boolean;
  legendRef: RefObject<HTMLDivElement | null>;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}

export function MapView({
  facilities,
  allFacilities,
  vacancyOf,
  vacancyExpiredOf,
  distanceOf,
  home,
  selectedId,
  mapShown,
  legendRef,
  onSelect,
  onDeselect,
}: Props) {
  const { theme } = useTheme();
  const hintId = useId();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(true);
  const popupRef = useRef<maplibregl.Popup>(null);
  useLayoutEffect(() => {
    mapContainerRef.current?.setAttribute('aria-busy', String(busyRef.current));
  }, []);
  const selected = facilities.find((facility) => facility.id === selectedId);
  const [closedId, setClosedId] = useState<string | null>(null);
  const [previousSelectedId, setPreviousSelectedId] = useState(selectedId);
  if (previousSelectedId !== selectedId) {
    setPreviousSelectedId(selectedId);
    setClosedId(null);
  }
  const [initialBounds] = useState(() => boundsFor(allFacilities, 0.05));
  const popupOpen = !!selected && closedId !== selected.id;
  const distance = selected ? distanceOf(selected) : null;
  const selectMarker = (id: string) => {
    setClosedId(id === selectedId && popupOpen ? id : null);
    onSelect(id);
  };
  return (
    <div ref={mapContainerRef} className={`${styles.map}${theme === 'dark' ? ` ${styles.mapDark}` : ''}`}>
      <p id={hintId} className="visually-hidden">
        地図のピンはクリックかタップで選べます。キーボードや読み上げでは、表示切替でリストを開き、施設一覧から施設を選んでください。
      </p>
      <MapGL
        locale={{ 'Map.Title': '地図' }}
        onMoveStart={() => {
          busyRef.current = true;
          mapContainerRef.current?.setAttribute('aria-busy', 'true');
        }}
        onIdle={() => {
          busyRef.current = false;
          mapContainerRef.current?.setAttribute('aria-busy', 'false');
        }}
        mapLib={maplibregl}
        mapStyle={mapStyleFor(theme)}
        initialViewState={{ bounds: initialBounds }}
        transformRequest={transformRequest}
        maxZoom={17}
        trackResize={false}
        scrollZoom
        localIdeographFontFamily="sans-serif"
        attributionControl={false}
        dragRotate={false}
        touchPitch={false}
      >
        <MapController
          facilities={facilities}
          home={home}
          selectedId={selectedId}
          initialBounds={initialBounds}
          popupRef={popupRef}
          popupOpen={popupOpen}
          mapShown={mapShown}
          legendRef={legendRef}
        />
        <NavigationControl position="top-left" showCompass={false} />
        {home && <HomeControl home={home} facilities={facilities} legendRef={legendRef} />}
        <AttributionControl compact={false} />
        <PinOverlay
          hintId={hintId}
          theme={theme}
          facilities={facilities}
          allFacilities={allFacilities}
          vacancyOf={vacancyOf}
          selectedId={selectedId}
          home={home}
          onSelect={selectMarker}
          onDeselect={onDeselect}
        />
        {selected && popupOpen && (
          <FacilityPopup
            key={selected.id}
            popupRef={popupRef}
            longitude={selected.lng}
            latitude={selected.lat}
            onClose={() => setClosedId(selected.id)}
          >
            <div role="group" aria-label="施設の詳細">
              <strong>{selected.name}</strong>
              <div className={styles.popupMeta}>
                {selected.wardName} ・ {FACILITY_TYPE_LABELS[selected.facilityType].label}
                {selected.licensing === 'unlicensed' && ` ・ ${LICENSING_LABELS[selected.licensing]}`}
                {distance !== null && ` ・ 自宅から${formatDistance(distance)}`}
              </div>
              <div className={styles.popupVacancy}>
                {selected.vacancies.map((value, age) => {
                  const group = selected.sharedVacancy?.ages.includes(age) ? selected.sharedVacancy.ages : [age];
                  if (group[0] !== age) return null;
                  return (
                    <span key={age} className={value === null ? styles.na : value > 0 ? styles.open : styles.full}>
                      {group.length > 1 ? `${group.join('・')}歳` : AGE_LABELS[age]} {value === null ? '—' : value}
                    </span>
                  );
                })}
              </div>
              {vacancyExpiredOf(selected) && <VacancyExpiryBadge />}
            </div>
          </FacilityPopup>
        )}
      </MapGL>
    </div>
  );
}

import { useId, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import MapGL, { AttributionControl, NavigationControl } from 'react-map-gl/maplibre';
import type { Facility, Home } from '../../schema';
import { formatDistance } from '../../lib/geo';
import { AGE_LABELS } from '../../lib/vacancy';
import { FACILITY_TYPE_LABELS, LICENSING_LABELS } from '../../lib/facility-labels';
import { VacancyExpiryBadge } from '../dataset/VacancyExpiry';
import { MapController } from './MapController';
import { FacilityPopup } from './FacilityPopup';
import { boundsFor } from './map-bounds';
import { createMapStyle } from './map-style';
import styles from './MapView.module.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PinOverlay } from './PinOverlay';

maplibregl.setWorkerUrl(workerUrl);
const mapStyle = createMapStyle(window.location.origin);
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
  onSelect: (id: string) => void;
}

export function MapView({
  facilities,
  allFacilities,
  vacancyOf,
  vacancyExpiredOf,
  distanceOf,
  home,
  selectedId,
  onSelect,
}: Props) {
  const hintId = useId();
  const popupRef = useRef<maplibregl.Popup>(null);
  const [busy, setBusy] = useState(true);
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
    <div className={styles.map} aria-busy={busy}>
      <p id={hintId} className="visually-hidden">
        地図のピンはクリックかタップで選べます。キーボードや読み上げでは、表示切替でリストを開き、施設一覧から施設を選んでください。
      </p>
      <MapGL
        locale={{ 'Map.Title': '地図' }}
        onMoveStart={() => setBusy(true)}
        onIdle={() => setBusy(false)}
        mapLib={maplibregl}
        mapStyle={mapStyle}
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
        />
        <NavigationControl position="top-left" showCompass={false} />
        <AttributionControl compact={false} />
        <PinOverlay
          hintId={hintId}
          facilities={facilities}
          allFacilities={allFacilities}
          vacancyOf={vacancyOf}
          selectedId={selectedId}
          home={home}
          onSelect={selectMarker}
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

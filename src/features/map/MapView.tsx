import { useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import MapGL, { AttributionControl, Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre';
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
import './pins.css';

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

function FacilityMarker({
  facility,
  count,
  selected,
  southRank,
  onSelect,
}: {
  facility: Facility;
  count: number;
  selected: boolean;
  southRank: number;
  onSelect: (id: string) => void;
}) {
  const label = `${facility.name}（${LICENSING_LABELS[facility.licensing]}）${count > 0 ? `空き${count}人` : '空きなし'}`;
  return (
    <Marker
      longitude={facility.lng}
      latitude={facility.lat}
      className="facility-marker"
      style={{ zIndex: (selected ? 2 : count > 0 ? 1 : 0) * 10000 + southRank }}
    >
      <button
        type="button"
        className={styles.pinButton}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(facility.id);
        }}
      >
        <span
          role="img"
          aria-label={label}
          className={`pin ${count > 0 ? 'pin--open' : 'pin--full'}${facility.licensing === 'unlicensed' ? ' pin--unlicensed' : ''}${selected ? ' pin--selected' : ''}`}
        >
          {count > 0 ? count : '×'}
        </span>
      </button>
    </Marker>
  );
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
  const popupRef = useRef<maplibregl.Popup>(null);
  const [busy, setBusy] = useState(true);
  const selected = facilities.find((facility) => facility.id === selectedId);
  const [closedId, setClosedId] = useState<string | null>(null);
  const [previousSelectedId, setPreviousSelectedId] = useState(selectedId);
  if (previousSelectedId !== selectedId) {
    setPreviousSelectedId(selectedId);
    setClosedId(null);
  }
  const southRanks = new Map([...allFacilities].sort((a, b) => b.lat - a.lat).map((facility, rank) => [facility.id, rank]));
  const [initialBounds] = useState(() => boundsFor(allFacilities, 0.05));
  const popupOpen = !!selected && closedId !== selected.id;
  const distance = selected ? distanceOf(selected) : null;
  const selectMarker = (id: string) => {
    setClosedId((current) => (id === selectedId && current !== id ? id : null));
    onSelect(id);
  };
  return (
    <div className={styles.map} aria-busy={busy}>
      <MapGL
        onMoveStart={() => setBusy(true)}
        onIdle={() => setBusy(false)}
        mapLib={maplibregl}
        mapStyle={mapStyle}
        transformRequest={transformRequest}
        maxZoom={18}
        scrollZoom
        localIdeographFontFamily="sans-serif"
        attributionControl={false}
        dragRotate={false}
        touchPitch={false}
      >
        <NavigationControl position="top-left" showCompass={false} />
        <AttributionControl compact={false} />
        {home && (
          <Marker longitude={home.lng} latitude={home.lat} style={{ zIndex: 30000 }}>
            <div className="pin pin--home" aria-label="自宅" title={home.label}>
              家
            </div>
          </Marker>
        )}
        {home && selected && (
          <Source
            id="home-route"
            type="geojson"
            data={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [
                  [home.lng, home.lat],
                  [selected.lng, selected.lat],
                ],
              },
            }}
          >
            <Layer id="home-route" type="line" paint={{ 'line-color': '#e8743b', 'line-width': 3, 'line-dasharray': [2, 2] }} />
          </Source>
        )}
        {facilities.map((facility) => (
          <FacilityMarker
            key={facility.id}
            facility={facility}
            count={vacancyOf(facility)}
            selected={facility.id === selectedId}
            southRank={southRanks.get(facility.id)!}
            onSelect={selectMarker}
          />
        ))}
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
        {/* 開き直した Popup の DOM ができる前に補正しないよう、制御は最後に置く。 */}
        <MapController
          facilities={facilities}
          home={home}
          selectedId={selectedId}
          initialBounds={initialBounds}
          popupRef={popupRef}
          popupOpen={popupOpen}
        />
      </MapGL>
    </div>
  );
}

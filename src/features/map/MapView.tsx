import { useEffect, useRef, useState, type RefObject } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip } from 'react-leaflet';
import type { Facility, Home } from '../../schema';
import { formatDistance } from '../../lib/geo';
import { AGE_LABELS } from '../../lib/vacancy';
import { FACILITY_TYPE_LABELS, LICENSING_LABELS } from '../../lib/facility-labels';
import { MapController } from './MapController';
import styles from './MapView.module.css';
import 'leaflet/dist/leaflet.css';
import './pins.css';

interface Props {
  facilities: Facility[];
  allFacilities: Facility[];
  vacancyOf: (f: Facility) => number;
  distanceOf: (f: Facility) => number | null;
  home: Home | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function facilityIcon(count: number, selected: boolean, facility: Facility) {
  const pin = document.createElement('div');
  pin.className = `pin ${count > 0 ? 'pin--open' : 'pin--full'}${facility.licensing === 'unlicensed' ? ' pin--unlicensed' : ''}${selected ? ' pin--selected' : ''}`;
  pin.textContent = count > 0 ? String(count) : '×';
  pin.setAttribute('role', 'img');
  pin.setAttribute(
    'aria-label',
    `${facility.name}（${LICENSING_LABELS[facility.licensing]}）${count > 0 ? `空き${count}人` : '空きなし'}`,
  );
  return L.divIcon({
    className: '',
    html: pin,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

const homeIcon = L.divIcon({
  className: '',
  html: '<div class="pin pin--home" aria-label="自宅">家</div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

function SelectedPopup({ selectedId, markerRefs }: { selectedId: string | null; markerRefs: RefObject<Map<string, L.Marker>> }) {
  useEffect(() => {
    if (selectedId) markerRefs.current.get(selectedId)?.openPopup();
  }, [selectedId, markerRefs]);
  return null;
}

export function MapView({ facilities, allFacilities, vacancyOf, distanceOf, home, selectedId, onSelect }: Props) {
  const markerRefs = useRef(new Map<string, L.Marker>());
  const selected = facilities.find((f) => f.id === selectedId);
  // URL の初期絞り込みにかかわらず全施設を収め、以後の絞り込みでは範囲を変えない。
  const [initialBounds] = useState(() => L.latLngBounds(allFacilities.map((f) => L.latLng(f.lat, f.lng))).pad(0.05));

  return (
    <MapContainer bounds={initialBounds} className={styles.map} scrollWheelZoom>
      <TileLayer
        url="https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"
        attribution='<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>'
        maxZoom={18}
      />
      <MapController facilities={facilities} home={home} selectedId={selectedId} />

      {home && (
        <Marker position={[home.lat, home.lng]} icon={homeIcon} zIndexOffset={1000}>
          <Tooltip direction="top" offset={[0, -16]}>
            {home.label}
          </Tooltip>
        </Marker>
      )}
      {home && selected && (
        <Polyline
          className="route-line"
          positions={[
            [home.lat, home.lng],
            [selected.lat, selected.lng],
          ]}
          pathOptions={{
            weight: 3,
            dashArray: '6 6',
          }}
        />
      )}

      {facilities.map((f) => {
        const count = vacancyOf(f);
        const distance = distanceOf(f);
        return (
          <Marker
            key={f.id}
            position={[f.lat, f.lng]}
            icon={facilityIcon(count, f.id === selectedId, f)}
            zIndexOffset={f.id === selectedId ? 900 : count > 0 ? 100 : 0}
            eventHandlers={{ click: () => onSelect(f.id) }}
            ref={(m) => {
              if (m) markerRefs.current.set(f.id, m);
              else markerRefs.current.delete(f.id);
            }}
          >
            <Popup>
              <div role="group" aria-label="施設の詳細">
                <strong>{f.name}</strong>
                <div className={styles.popupMeta}>
                  {f.wardName} ・ {FACILITY_TYPE_LABELS[f.facilityType].label}
                  {f.licensing === 'unlicensed' && ` ・ ${LICENSING_LABELS[f.licensing]}`}
                  {distance !== null && ` ・ 自宅から${formatDistance(distance)}`}
                </div>
                <div className={styles.popupVacancy}>
                  {f.vacancies.map((v, age) => {
                    const group = f.sharedVacancy?.ages.includes(age) ? f.sharedVacancy.ages : [age];
                    if (group[0] !== age) return null;
                    return (
                      <span key={age} className={v === null ? styles.na : v > 0 ? styles.open : styles.full}>
                        {group.length > 1 ? `${group.join('・')}歳` : AGE_LABELS[age]} {v === null ? '—' : v}
                      </span>
                    );
                  })}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
      {/* react-leaflet の passive effect（addLayer と bindPopup）より後に開く必要があるため、マーカーより後に置く。 */}
      <SelectedPopup selectedId={selectedId} markerRefs={markerRefs} />
    </MapContainer>
  );
}

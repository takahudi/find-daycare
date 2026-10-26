import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Facility, Home } from '../schema';
import { formatDistance } from '../lib/geo';
import { AGE_LABELS } from '../lib/vacancy';
import { FACILITY_TYPE_LABELS, LICENSING_LABELS } from '../lib/facility-labels';

interface Props {
  facilities: Facility[];
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

/** 選択された施設・自宅の変化に合わせて地図を動かす */
function MapController({ facilities, home, selectedId }: Pick<Props, 'facilities' | 'home' | 'selectedId'>) {
  const map = useMap();
  const selected = facilities.find((f) => f.id === selectedId);
  // 自宅が変わったときだけ寄せたい（並べ替え・絞り込みのたびには動かさない）ので、一覧は ref で参照する
  const facilitiesRef = useRef(facilities);
  useEffect(() => {
    facilitiesRef.current = facilities;
  }, [facilities]);

  // スマホ幅でリストタブを表示中は地図が非表示（サイズ0）で、その状態で移動すると座標計算が NaN になり落ちる。
  // 非表示の間に来た移動は覚えておき、地図が表示されてから実行する
  const pendingMove = useRef<(() => void) | null>(null);
  const moveWhenVisible = useCallback(
    (move: () => void) => {
      const { clientWidth, clientHeight } = map.getContainer();
      if (clientWidth && clientHeight) move();
      else pendingMove.current = move;
    },
    [map],
  );

  useEffect(() => {
    // サイドバー開閉・タブ切替などでコンテナサイズが変わったときにタイルを描き直す
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      const { clientWidth, clientHeight } = map.getContainer();
      if (pendingMove.current && clientWidth && clientHeight) {
        const move = pendingMove.current;
        pendingMove.current = null;
        move();
      }
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (!selected) return;
    moveWhenVisible(() => map.flyTo([selected.lat, selected.lng], Math.max(map.getZoom(), 16), { duration: 0.6 }));
  }, [map, selected, moveWhenVisible]);

  useEffect(() => {
    if (!home) return;
    const origin = L.latLng(home.lat, home.lng);
    const nearest = facilitiesRef.current
      .map((f) => L.latLng(f.lat, f.lng))
      .sort((a, b) => origin.distanceTo(a) - origin.distanceTo(b))
      .slice(0, 5);
    moveWhenVisible(() => map.flyToBounds(L.latLngBounds([origin, ...nearest]).pad(0.2), { duration: 0.6, maxZoom: 16 }));
  }, [map, home, moveWhenVisible]);

  return null;
}

export function MapView({ facilities, vacancyOf, distanceOf, home, selectedId, onSelect }: Props) {
  const markerRefs = useRef(new Map<string, L.Marker>());
  const selected = useMemo(() => facilities.find((f) => f.id === selectedId), [facilities, selectedId]);
  // 初期表示は全施設が収まる範囲（以後は絞り込みで地図を動かさない）
  const [initialBounds] = useState(() => L.latLngBounds(facilities.map((f) => L.latLng(f.lat, f.lng))).pad(0.05));

  useEffect(() => {
    if (selectedId) markerRefs.current.get(selectedId)?.openPopup();
  }, [selectedId]);

  return (
    <MapContainer bounds={initialBounds} className="map" scrollWheelZoom>
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
          positions={[
            [home.lat, home.lng],
            [selected.lat, selected.lng],
          ]}
          pathOptions={{ color: '#e8743b', weight: 3, dashArray: '6 6' }}
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
                <div className="popup-meta">
                  {f.wardName} ・ {FACILITY_TYPE_LABELS[f.facilityType].label}
                  {f.licensing === 'unlicensed' && ` ・ ${LICENSING_LABELS[f.licensing]}`}
                  {distance !== null && ` ・ 自宅から${formatDistance(distance)}`}
                </div>
                <div className="popup-vacancy">
                  {f.vacancies.map((v, age) => {
                    const group = f.sharedVacancy?.ages.includes(age) ? f.sharedVacancy.ages : [age];
                    if (group[0] !== age) return null;
                    return (
                      <span key={age} className={v === null ? 'na' : v > 0 ? 'open' : 'full'}>
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
    </MapContainer>
  );
}

import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { Facility, Home } from '../../schema';

/** 選択された施設・自宅の変化に合わせて地図を動かす */
export function MapController({
  facilities,
  home,
  selectedId,
}: {
  facilities: Facility[];
  home: Home | null;
  selectedId: string | null;
}) {
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
  // コンパイラは map だけでキャッシュするが、exhaustive-deps が明示的な同一性を要求するため残す
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
    if (!home) return;
    const origin = L.latLng(home.lat, home.lng);
    const nearest = facilitiesRef.current
      .map((f) => L.latLng(f.lat, f.lng))
      .sort((a, b) => origin.distanceTo(a) - origin.distanceTo(b))
      .slice(0, 5);
    moveWhenVisible(() => map.flyToBounds(L.latLngBounds([origin, ...nearest]).pad(0.2), { duration: 0.6, maxZoom: 16 }));
  }, [map, home, moveWhenVisible]);

  useEffect(() => {
    if (!selected) return;
    moveWhenVisible(() => map.flyTo([selected.lat, selected.lng], Math.max(map.getZoom(), 16), { duration: 0.6 }));
  }, [map, selected, moveWhenVisible]);

  return null;
}

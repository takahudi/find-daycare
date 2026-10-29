import { useEffect, useRef, type ReactNode } from 'react';
import { Popup, useMap } from 'react-map-gl/maplibre';
import type { Popup as PopupInstance } from 'maplibre-gl';

export function FacilityPopup({
  longitude,
  latitude,
  onClose,
  children,
}: {
  longitude: number;
  latitude: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const { current: map } = useMap();
  const popup = useRef<PopupInstance>(null);
  useEffect(() => {
    if (!map || !popup.current) return undefined;
    const element = popup.current.getElement();
    const keepVisible = () => {
      if (map.isMoving()) return;
      const container = map.getContainer().getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      const dx = Math.min(0, bounds.left - container.left - 8) + Math.max(0, bounds.right - container.right + 8);
      const dy = Math.min(0, bounds.top - container.top - 8) + Math.max(0, bounds.bottom - container.bottom + 8);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) map.panBy([dx, dy], { duration: 0 });
    };
    // 選択時の flyTo を待つ。常設すると、その後のドラッグや現在地への移動まで引き戻してしまう。
    if (map.isMoving()) map.once('moveend', keepVisible);
    else keepVisible();
    return () => {
      map.off('moveend', keepVisible);
    };
  }, [map]);
  return (
    <Popup
      ref={popup}
      longitude={longitude}
      latitude={latitude}
      anchor="bottom"
      offset={18}
      style={{ zIndex: 1100 }}
      maxWidth="320px"
      focusAfterOpen={false}
      onClose={onClose}
    >
      {children}
    </Popup>
  );
}

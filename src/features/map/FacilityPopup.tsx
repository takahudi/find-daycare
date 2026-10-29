import type { ReactNode, RefObject } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import type { Popup as PopupInstance } from 'maplibre-gl';

export const POPUP_OFFSET = 18;

export function FacilityPopup({
  popupRef,
  longitude,
  latitude,
  onClose,
  children,
}: {
  popupRef: RefObject<PopupInstance | null>;
  longitude: number;
  latitude: number;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Popup
      ref={popupRef}
      longitude={longitude}
      latitude={latitude}
      anchor="bottom"
      offset={POPUP_OFFSET}
      style={{ zIndex: 40000 }}
      maxWidth="320px"
      focusAfterOpen={false}
      onClose={onClose}
    >
      {children}
    </Popup>
  );
}

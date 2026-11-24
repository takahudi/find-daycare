import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { IControl } from 'maplibre-gl';
import { useControl, useMap } from 'react-map-gl/maplibre';
import type { Facility, Home } from '../../schema';
import { centerOnHome } from './home-camera';
import styles from './MapView.module.css';

class HomeControlSlot implements IControl {
  readonly container: HTMLDivElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
  }

  onAdd() {
    return this.container;
  }

  onRemove() {
    this.container.remove();
  }
}

export function HomeControl({
  home,
  facilities,
  legendRef,
}: {
  home: Home;
  facilities: Facility[];
  legendRef: RefObject<HTMLDivElement | null>;
}) {
  const { current: map } = useMap();
  const control = useControl(() => new HomeControlSlot(), { position: 'top-left' });

  return createPortal(
    <button
      type="button"
      className={styles.homeControlButton}
      aria-label="自宅に戻る"
      title="自宅に戻る"
      onClick={() => {
        if (!map) return;
        centerOnHome(map, home, facilities, legendRef.current, 600);
      }}
    >
      <svg
        className={styles.homeControlIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" />
        <path d="M9.5 21v-6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6" />
      </svg>
    </button>,
    control.container,
  );
}

import type { Map as MapLibreMap } from 'maplibre-gl';
import { parsePinImageId, type PinFace } from './pin-face';
import { PIN_LAYER_IDS, type PinLayerId, type ScreenPoint } from './pin-layers';

export interface RenderedPin {
  readonly layer: PinLayerId;
  readonly key: string;
  readonly face: PinFace;
  readonly clientX: number;
  readonly clientY: number;
}
export interface PinProbe {
  rendered(): RenderedPin[];
  pick(clientX: number, clientY: number): string | null;
}
declare global {
  interface Window {
    __findDaycarePins?: PinProbe;
  }
}

// e2e でも配信物そのものを検証するため、読み取り専用の観測口を本番にも残す。
export function installPinProbe(map: MapLibreMap, pick: (point: ScreenPoint) => string | null): () => void {
  const probe: PinProbe = Object.freeze({
    rendered: () => {
      const rect = map.getContainer().getBoundingClientRect();
      const seen = new Set<string>();
      return map.queryRenderedFeatures({ layers: [...PIN_LAYER_IDS] }).flatMap((feature) => {
        const face = parsePinImageId(feature.properties.image);
        const layer = PIN_LAYER_IDS.find((id) => id === feature.layer.id);
        const identity = `${layer}:${feature.properties.key}`;
        if (!face || !layer || feature.geometry.type !== 'Point' || seen.has(identity)) return [];
        seen.add(identity);
        const point = map.project([feature.geometry.coordinates[0], feature.geometry.coordinates[1]]);
        return [{ layer, key: String(feature.properties.key), face, clientX: rect.left + point.x, clientY: rect.top + point.y }];
      });
    },
    pick: (clientX: number, clientY: number) => {
      const rect = map.getContainer().getBoundingClientRect();
      return pick({ x: clientX - rect.left, y: clientY - rect.top });
    },
  });
  window.__findDaycarePins = probe;
  return () => {
    if (window.__findDaycarePins === probe) delete window.__findDaycarePins;
  };
}

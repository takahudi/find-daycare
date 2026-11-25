import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import type { Theme } from '../../app/theme';
import tiles from '../../../data/map/tiles.json';
import assets from '../../../data/map/assets.json';
import { pinLayers, pinSources } from './pin-layers';

export function createMapStyle(origin: string, theme: Theme = 'light'): StyleSpecification {
  return {
    version: 8,
    glyphs: assets.glyphs,
    sprite: new URL(assets.sprites[theme], origin).href,
    sources: {
      ...pinSources(),
      basemap: {
        type: 'vector',
        tiles: [`/map/tiles/${tiles.source.build}/{z}/{x}/{y}.mvt`],
        minzoom: tiles.minZoom,
        maxzoom: tiles.maxZoom,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · <a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a>',
      },
    },
    layers: [...layers('basemap', namedFlavor(theme), { lang: 'ja' }), ...pinLayers()],
  };
}

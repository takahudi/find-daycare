import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import tiles from '../../../data/map/tiles.json';
import assets from '../../../data/map/assets.json';

export function createMapStyle(origin: string): StyleSpecification {
  return {
    version: 8,
    glyphs: assets.glyphs,
    sprite: new URL(assets.sprite, origin).href,
    sources: {
      basemap: {
        type: 'vector',
        tiles: [`/map/tiles/${tiles.source.build}/{z}/{x}/{y}.mvt`],
        minzoom: tiles.minZoom,
        maxzoom: tiles.maxZoom,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · <a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a>',
      },
    },
    layers: layers('basemap', namedFlavor('light'), { lang: 'ja' }),
  };
}

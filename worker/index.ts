import { serveTile } from './tiles.ts';

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/map/tiles/')) return serveTile(request, env.MAP_TILES);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

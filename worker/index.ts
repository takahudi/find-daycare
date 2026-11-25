import { serveTile } from './tiles.ts';

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith('/map/tiles/')) {
      return serveTile(request, env.MAP_TILES, {
        cache: caches.default,
        waitUntil: (promise) => ctx.waitUntil(promise),
      });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

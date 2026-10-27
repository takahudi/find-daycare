import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'worker/**/*.test.ts'],
      unstubGlobals: true,
    },
  }),
);

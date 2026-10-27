import { cloudflare } from '@cloudflare/vite-plugin';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    babel({
      presets: [
        reactCompilerPreset({
          target: '19',
          // 最適化できないコンポーネントを黙って未コンパイルにしない
          panicThreshold: 'all_errors',
          // 関数・ファイル単位の除外指示で最適化をすり抜けさせない
          customOptOutDirectives: [],
        }),
      ],
    }),
    // Node の単体テストでは workerd の開発サーバーを起動しない
    ...(process.env.VITEST ? [] : [cloudflare()]),
  ],
});

import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Node の単体テストでは workerd の開発サーバーを起動しない
  plugins: [react(), ...(process.env.VITEST ? [] : [cloudflare()])],
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api and /ws to a locally running api-node
// (default http://localhost:3000). In production (docker-compose) the
// same two paths are proxied by nginx, so the built app calls relative
// paths and needs no VITE_API_URL at runtime.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});

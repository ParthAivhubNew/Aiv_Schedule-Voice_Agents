import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The staff admin portal is its own page (admin.html), served for every /admin path.
const adminPortalPaths = {
  name: 'admin-portal-paths',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (/^\/admin(\/|$|\?)/.test(req.url || '')) req.url = '/admin.html';
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), adminPortalPaths],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
        timeout: 180000,
        proxyTimeout: 180000,
      },
      '/v1': {
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
        timeout: 180000,
        proxyTimeout: 180000,
      },
      '/media': {
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: process.env.VITE_WS_URL || 'ws://127.0.0.1:8000',
        ws: true,
        secure: false,
      },
    },
  },
});

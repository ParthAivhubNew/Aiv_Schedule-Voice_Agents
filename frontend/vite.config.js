import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'https://outreach.aivhub.com',
        changeOrigin: true,
        secure: false,
        timeout: 180000,
        proxyTimeout: 180000,
      },
      '/media': {
        target: process.env.VITE_BACKEND_URL || 'https://outreach.aivhub.com',
        changeOrigin: true,
        secure: false,
      },
      '/ws': {
        target: process.env.VITE_WS_URL || 'wss://outreach.aivhub.com',
        ws: true,
        secure: false,
      },
    },
  },
});

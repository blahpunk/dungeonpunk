import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/dev': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      },
      '/ws': {
        target: 'http://127.0.0.1:3000',
        ws: true,
        changeOrigin: true
      }
    }
  }
});

import { defineConfig } from 'vite';

const backendTarget = process.env.BACKEND_URL || 'http://localhost:5000';

export default defineConfig({
  server: {
    port: 3000,
    watch: {
      ignored: ['**/node_modules/**', '**/public/videos/**'],
    },
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});

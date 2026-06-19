import { defineConfig } from 'vite';
import http from 'http';

// Try common backend ports if BACKEND_URL is not explicitly set
const explicitBackend = process.env.BACKEND_URL;
const BACKEND_PORTS = [5000, 5001, 5002, 5003, 5004];

function probePort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          resolve(body.status === 'healthy' ? port : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(1000, () => { req.destroy(); resolve(null); });
  });
}

async function resolveBackendUrl() {
  if (explicitBackend) return explicitBackend;
  for (const port of BACKEND_PORTS) {
    const found = await probePort(port);
    if (found) {
      console.log(`✅ Backend detected on port ${found}`);
      return `http://localhost:${found}`;
    }
  }
  console.warn(`⚠️  No backend detected on ports ${BACKEND_PORTS.join(', ')}. Defaulting to :5000`);
  return 'http://localhost:5000';
}

export default defineConfig(async () => {
  const backendTarget = await resolveBackendUrl();
  return {
  server: {
    port: 3000,
    strictPort: false,
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
  };
});

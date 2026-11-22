import { defineConfig } from 'vite';

// Locally, serve the Vercel function at /api/harbor so `npm run dev` and `npm run preview`
// work without the Vercel CLI. On Vercel, api/harbor.js runs as a serverless function.
async function run(handler, req, res) {
  const out = {
    setHeader: (k, v) => res.setHeader(k, v),
    status(c) { res.statusCode = c; return out; },
    json(o) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); },
  };
  await handler(req, out);
}

const localApi = () => ({
  name: 'local-api',
  configureServer(server) {
    server.middlewares.use('/api/harbor', async (req, res) => {
      const { default: handler } = await server.ssrLoadModule('/api/harbor.js');
      await run(handler, req, res);
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/harbor', async (req, res) => {
      const { default: handler } = await import('./api/harbor.js');
      await run(handler, req, res);
    });
  },
});

export default defineConfig({
  plugins: [localApi()],
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { chunkSizeWarningLimit: 2000 },
});

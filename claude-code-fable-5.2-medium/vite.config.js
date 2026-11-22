import { defineConfig } from 'vite';

// In local development, serve /api/harbor with the same handler Vercel runs in production.
const devApi = {
  name: 'dev-api',
  configureServer(server) {
    server.middlewares.use('/api/harbor', async (req, res) => {
      try {
        const mod = await server.ssrLoadModule('/api/harbor.js');
        await mod.default(req, res);
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err && err.message) }));
      }
    });
  },
};

export default defineConfig({
  plugins: [devApi],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});

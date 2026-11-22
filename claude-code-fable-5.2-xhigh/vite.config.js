import { defineConfig } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Serves the Vercel functions in ./api during `npm run dev` and `npm run preview`,
// so the app runs locally without a Vercel account. On Vercel the same files are
// deployed as serverless functions.
function localApi() {
  const attach = (server, load) => {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost');
      const m = url.pathname.match(/^\/api\/([a-z0-9_-]+)$/i);
      if (!m) return next();
      try {
        const mod = await load(m[1]);
        await mod.default(req, res);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      }
    });
  };
  return {
    name: 'local-api',
    configureServer(server) {
      attach(server, (name) => server.ssrLoadModule(`/api/${name}.js`));
    },
    configurePreviewServer(server) {
      attach(server, (name) => import(pathToFileURL(path.resolve('api', `${name}.js`)).href));
    },
  };
}

export default defineConfig({
  plugins: [localApi()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: { port: 5183 },
  preview: { port: 5183 },
});

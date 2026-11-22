import { defineConfig } from 'vite';
import harbor from './api/harbor.js';

function serveHarbor(server) {
  server.middlewares.use('/api/harbor', harbor);
}

export default defineConfig({
  plugins: [{
    name: 'harbor-local-api',
    configureServer: serveHarbor,
    configurePreviewServer: serveHarbor,
  }],
});

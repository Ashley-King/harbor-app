import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import harbor from "./api/harbor.js";
import imagery from "./api/imagery.js";
function api() {
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        let handler;
        if (url.pathname === "/api/harbor") handler = harbor;
        else if (url.pathname.startsWith("/imagery/")) {
          const [z, x, y] = url.pathname.slice(9).split("/");
          url.search = new URLSearchParams({ z, x, y }).toString();
          handler = imagery;
        } else if (url.pathname === "/api/imagery") handler = imagery;
        else return next();
        req.query = Object.fromEntries(url.searchParams);
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (data) => res.end(JSON.stringify(data));
        res.send = (data) => res.end(data);
        try {
          await handler(req, res);
        } catch {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: "Feed request failed" }));
        }
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), api()],
  build: {
    rollupOptions: {
      output: { manualChunks: { map: ["maplibre-gl"], models: ["three"] } },
    },
  },
});

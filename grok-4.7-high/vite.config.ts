import type { Plugin } from "vite";
import { defineConfig } from "vite";

function harborApi(): Plugin {
  return {
    name: "harbor-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/api/harbor") return next();
        try {
          const { getHarbor } = await import("./api/harbor");
          const body = await getHarbor();
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(JSON.stringify(body));
        } catch {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "harbor feed failed" }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [harborApi()],
  server: { port: 5173 },
});

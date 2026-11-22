import { defineConfig } from 'vite'
import harbor from './api/harbor.js'
import imagery from './api/imagery.js'

function localApi(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost')
    const handler = { '/api/harbor': harbor, '/api/imagery': imagery }[url.pathname]
    if (!handler) return next()
    req.query = Object.fromEntries(url.searchParams)
    res.status = (code) => {
      res.statusCode = code
      return res
    }
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(data))
    }
    res.send = (data) => res.end(data)
    try {
      await handler(req, res)
    } catch (err) {
      next(err)
    }
  })
}
export default defineConfig({
  plugins: [{ name: 'local-harbor-api', configureServer: localApi, configurePreviewServer: localApi }],
  build: {
    rollupOptions: { output: { manualChunks: { three: ['three'], leaflet: ['leaflet'] } } },
    chunkSizeWarningLimit: 650
  }
})

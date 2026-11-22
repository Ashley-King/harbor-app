# Charleston Harbor

Overhead view of the large ships in Charleston Harbor, South Carolina. The map uses aerial imagery. Ship positions, tide, and Ravenel Bridge clearance come from live feeds and refresh every 10 minutes.

This folder is one app in the shared harbor-app benchmark. It deploys on its own.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints. The dev server exposes `/api/harbor`, which reads Open Waters AIS and NOAA so the browser does not call those feeds itself.

## Data

- Ship positions: [Open Waters AIS](https://openwaters.io/api/ais/), bounding box `32.70,-80.05,32.95,-79.75`. No API key.
- Tide: NOAA CO-OPS water level at station 8665530 (Charleston), datum MLLW.
- Ravenel clearance: NOAA CO-OPS air gap at station 8665353.
- Imagery: Esri World Imagery (Maxar and Earthstar Geographics), credited on the map.
- Terminal and bridge outlines: OpenStreetMap. The Leatherman berth is placed on the west-bank crane wharf; the OSM polygon for that terminal sits inland of the water. The shipping channel is a centerline through the entrance, the Ravenel span, and the Cooper and Wando rivers. It is not a certified chart.

Large ships are drawn at their reported length and beam. When the whole harbor is in view and a ship would be smaller than a readable mark, it is enlarged just enough to stay visible, with the same proportions. Zoom in and it returns to true scale. A generic cargo report for a ship longer than 160 m that is moored at Wando Welch, North Charleston, or Leatherman is drawn as a container ship. The detail card still shows the reported type.

The page keeps the last good reading if a feed fails, marks that reading stale, and tries again on the next 10-minute refresh. Missing ship fields are shown as unknown. Nothing here is sample data.

Day and night follow sunrise and sunset at Charleston. Auto is the default. Day and Night force the look.

## Deploy

The Vercel project root is this folder. `npm run build` writes the site to `dist`. `/api/harbor` is a serverless function.

Live: https://harbor-grok-47-high.vercel.app

# Charleston Harbor Live

An overhead, map-style view of the large ships in Charleston Harbor, South Carolina, built from live AIS and NOAA data.

- Built by: Claude Code, model Opus 5.5, medium effort
- Folder: `claude-code-opus-5.5-medium`
- Vercel project: `harbor-claude-code-opus-5.5-medium`

## What it shows

- Real aerial imagery for land and water (USGS The National Map orthoimagery, public domain), with animated sun or moon glints on the water and planar shadows cast by ships, cranes and the Ravenel Bridge towers.
- Every large ship (AIS types 60 to 89, or longer than 150 m) as a 3D model of its kind: container ships with stacked boxes, tankers with pipe racks and manifolds, car carriers and ro-ros as tall boxy hulls, bulk carriers with hatches and deck cranes, cruise ships with white decks and pools. Models are scaled to the reported length and beam, placed using the AIS antenna offsets, and rotated to the reported heading.
- Tugs and pilot boats as small boats. All other traffic is hidden.
- Night mode by default after sunset: dark imagery, glowing streets, lit terminals, gantry cranes, Ravenel and Don Holt bridge lighting, and navigation lights on every ship (red port, green starboard, white masthead and stern lights when under way, anchor lights at anchor, deck lights when moored). Day and night switch at Charleston's real sunrise and sunset, with a manual Auto / Day / Night toggle.
- Labels for the Ravenel Bridge, Don Holt Bridge, the shipping channel and the Wando Welch, North Charleston, Leatherman and Columbus Street terminals.
- A side panel with ships grouped by terminal, under way, at anchor and at other berths, plus the live Charleston tide and the Ravenel Bridge air gap.
- Click a ship (on the map or in the list) for its name, flag, IMO, type, length × beam, speed, destination, ETA, draught and last report time. Missing fields show "unknown".

## Live data

The browser only talks to this app. `api/harbor.js` is a Vercel serverless function that, on each request, calls:

- Open Waters AIS: `GET https://ais.openwaters.io/v1/vessels?bbox=32.70,-80.05,32.95,-79.75` (plus `kind=vessel&max_age=6h`), and `/v1/vessels/{mmsi}/track` for moving ships so they follow their real path. No key.
- NOAA CO-OPS: water level at station 8665530 (Charleston), air gap at station 8665353 (Ravenel Bridge), and hi/lo tide predictions for the rising/falling note. No key.

The page refreshes every 10 minutes without reloading and shows when the data was last updated. If a feed fails, the last good data stays on screen, marked stale with its time, and the next refresh retries. Nothing is cached at build time and no ship data is ever invented.

Moving ships replay their real AIS track about 10 minutes behind live, so they glide continuously between refreshes instead of jumping. Each ship leaves a short fading wake.

Static geography (terminal outlines, crane positions, bridge decks, channel line) comes from OpenStreetMap via `scripts/fetch-osm-geo.mjs` and is stored in `src/geo.json`. Night street lighting and water outlines come from OpenFreeMap vector tiles (OpenStreetMap data).

AIS type codes do not say whether a cargo ship is a container ship, bulk carrier or car carrier, so the model style is inferred from the type code, the ship's name and its size. The card always shows the reported AIS type.

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173. The Vite dev server also serves `/api/harbor` locally, so no keys or Vercel CLI are needed. `npm run build && npm run preview` runs the production build the same way.

## Deploy

Deployed with the Vercel CLI as project `harbor-claude-code-opus-5.5-medium`, root directory set to this folder. No environment variables are required.

## Credits

Imagery: USGS The National Map. Ship positions: Open Waters AIS. Tide and air gap: NOAA CO-OPS. Map data © OpenStreetMap contributors, OpenFreeMap, OpenMapTiles. Not for navigation.

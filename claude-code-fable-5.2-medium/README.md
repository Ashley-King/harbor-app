# Charleston Harbor live ships

An overhead, photorealistic view of the large ships in Charleston Harbor, South Carolina, drawn from live AIS positions over real satellite imagery. Built by Claude Code (Fable 5.2, medium effort) for the Harbor App benchmark.

- Folder: `claude-code-fable-5.2-medium`
- Vercel project: `harbor-claude-code-fable-5.2-medium`
- Live URL: https://harbor-claude-code-fable-52-medium.vercel.app

## What it shows

- The whole harbor from the jetties to the Wando Welch and North Charleston terminals, on Esri World Imagery, with animated water, sun shadows and a night look with city, terminal, crane, bridge and buoy lighting.
- Every large ship (AIS types 60 to 89, or longer than 150 m) as a top-down 3D model of its vessel type, scaled to its reported length and beam and rotated to its heading. Tugs and pilot boats are small boats. Everything else is a faded dot.
- Navigation lights at night: red port and green starboard sidelights, white masthead and stern lights on vessels under way. Moored and anchored vessels show white anchor lights and deck lights instead, which is what the collision regulations require.
- A wake behind moving ships, a card for any ship you click, and a side panel with the ships at each of the four container terminals, the live tide and the live Ravenel Bridge clearance.
- Night and day modes. "Auto" (the default) follows Charleston's real sunrise and sunset, computed in the browser. The Day and Night buttons override it. You can also open the page with `?mode=night` or `?mode=day`.

## Live data

Nothing is sampled, cached at build time or made up. The browser calls one serverless function, `api/harbor.js`, which calls the sources:

| Data | Source | Notes |
| --- | --- | --- |
| Ship positions | [Open Waters AIS](https://openwaters.io/api/ais/) `GET /v1/vessels?bbox=32.70,-80.05,32.95,-79.75` | No key. Sent with `User-Agent: harbor-bench/1.0`. |
| Tide | NOAA CO-OPS water level, station 8665530 (Charleston), MLLW | No key. Also NOAA's next high and low prediction. |
| Bridge clearance | NOAA CO-OPS air gap, station 8665353 (Ravenel Bridge) | No key. |

The page refreshes every 10 minutes without reloading and shows when the data was last updated. Ships glide to their newly reported positions over about 45 seconds. If a feed fails, the last good data stays on screen, the feed is marked stale with the time of the last good data, and the next refresh tries again. Missing fields show as "unknown". Vessels that have not reported for more than 6 hours are hidden.

## Run it locally

Requires Node 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open the address Vite prints (http://localhost:5173 by default). The dev server runs the same `api/harbor.js` handler that Vercel runs, so local data is live too. No environment variables or keys are needed.

```bash
npm run build
```

builds the static site into `dist/`.

## Deployment

Live at https://harbor-claude-code-fable-52-medium.vercel.app (Vercel drops the dot from the project name in the address).

Deployed to Vercel as its own project, `harbor-claude-code-fable-5.2-medium`, with this folder as the root directory. Vercel builds the Vite site and serves `api/harbor.js` as a serverless function. There are no environment variables. The project is not connected to GitHub, so it is deployed with the Vercel CLI from a clean copy of the committed folder.

## How it is built

- `index.html`, `src/style.css`: page and panels.
- `src/main.js`: scene, camera, live updates, ship motion, labels, ship card and side panel.
- `src/ground.js`: satellite tile loader and the ground shader (water, night lighting).
- `src/ships.js`: procedural 3D ship models, navigation light layouts and the wake shader.
- `src/structures.js`: Ravenel and Don Holt bridges, container cranes, fixed lights, channel lines.
- `src/lights.js`: the point light renderer. `src/sun.js`: sun position, sunrise and sunset. `src/geo.js`: map projection.
- `src/geo.json`, `public/watermask.png`: static geography, built once by the scripts in `tools/`.
- `api/harbor.js`: the serverless data function.

Rendering uses three.js. There is no map library and no API key.

## Honest limits

- AIS says only "cargo" for container ships, car carriers and bulk carriers alike. The cargo model is inferred, in this order: the ship's name (for example a container line's name), the terminal it is berthed at, then its size. The ship card always says which model was drawn and why, next to the type AIS actually reported.
- Deck cargo, colours and fittings on the models are illustrative. Size, position, heading and all card fields are from AIS.
- A vessel with no reported length or beam cannot be drawn to scale, so it appears as an amber marker and its card says the size is unknown.
- Some moored vessels do not report a heading. They are drawn using their last course, and the card says the orientation is not reliable.
- The satellite photo is not live, so it contains ships that were in port when it was taken. Close in, the water is drawn procedurally to hide them, but a few show at berth edges.
- AIS positions arrive every 10 minutes, so a moving ship is shown at its last reported position, not where it is this second.
- The channel lines are the charted range and track lines from OpenSeaMap, which cover the entrance channel and lower harbor only.

## Credits

- Imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics, and the GIS User Community).
- Ship positions: Open Waters AIS, with aisstream.io and AISHub as credited by the feed.
- Tide and air gap: NOAA Center for Operational Oceanographic Products and Services.
- Bridges, terminals, cranes, buoys and channel lines: © OpenStreetMap contributors (ODbL), including OpenSeaMap seamarks.
- Water mask: U.S. Geological Survey, National Hydrography Dataset (National Map hydro tiles).

## Security

No secrets are used or stored. `.gitignore` excludes `.env*`, `.vercel` and `node_modules`.

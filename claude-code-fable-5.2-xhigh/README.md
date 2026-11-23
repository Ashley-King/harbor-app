# Charleston Harbor, live ships

An overhead view of the large ships in Charleston Harbor, South Carolina, drawn over real aerial imagery with live AIS positions, live tide and live Ravenel Bridge clearance.

- Built by: Claude Code, model Fable 5.2, effort xhigh
- Folder: `claude-code-fable-5.2-xhigh`
- Vercel project: `harbor-claude-code-fable-5.2-xhigh`
- Live URL: https://harbor-claude-code-fable-52-xhigh.vercel.app

## What you see

- The whole harbor from the jetties to the Wando Welch and North Charleston terminals, north up, on USGS aerial photos.
- Every vessel as a 3D model of its kind, scaled to its reported length and beam and turned to its heading: container ships, tankers, car carriers, bulk carriers, cruise ships, tugs, pilot boats, and also sailing yachts, motor yachts, fishing boats, patrol and rescue boats, workboats and dredges. A checkbox hides the small craft.
- Night view with street, terminal, bridge, crane and dock lights, and navigation lights on every ship: red to port, green to starboard, white masthead and stern lights. Day view with the real sun direction and shadows.
- The view follows Charleston's real sunrise and sunset. The Auto, Day and Night buttons hold either view.
- A side panel with the ships at each container terminal, ships under way, other berths, the tide at Charleston and the clearance under the Ravenel Bridge.
- Select a ship for its card: name, flag, IMO, type, length and beam, speed, destination, ETA, draught and last report time. A missing field reads "unknown".

## Run it locally

Node 20.19 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5183. The dev server also serves the function in `api/`, so no Vercel account and no keys are needed.

To check the production build:

```bash
npm run build
```

```bash
npm run preview
```

## Live data

The browser calls one endpoint in this app, `/api/harbor`, every 10 minutes. That Vercel serverless function calls the sources, so the browser never depends on them directly. None of the sources needs a key, and the function sends the User-Agent `harbor-bench/1.0`.

| Data | Source |
| --- | --- |
| Ship positions and details | Open Waters AIS, `GET https://ais.openwaters.io/v1/vessels?bbox=32.70,-80.05,32.95,-79.75` |
| Track of each ship that is under way | Open Waters AIS, `/v1/vessels/{mmsi}/track` |
| Water level and tide predictions | NOAA CO-OPS station 8665530, Charleston |
| Bridge clearance (air gap) | NOAA CO-OPS station 8665353, Ravenel Bridge |

Rules the app follows:

- Only vessels in the live feed are drawn. The aerial photos show the ships and boats that were in port on the day they were flown, so the water is redrawn by a shader and those photographed vessels are removed, in the marinas too.
- No sample or stored ship data exists anywhere in the app.
- If a feed fails, the last good data stays on screen, marked stale with the time it was fetched. The next 10 minute refresh tries again.
- A vessel not heard for 3 hours is drawn dimmed. A vessel not heard for 24 hours is not drawn.

### How ships move between updates

For each ship that is under way, the function also fetches the track it actually sailed. Between refreshes the model moves along that real track at the ship's real speed and reaches the newest reported position by the time the next refresh is due. Every drawn position is one the ship really reported, so a moving ship never cuts across land. The cost is that a moving ship is drawn up to one refresh behind its newest report. The card always shows the newest report, and a ring on the map marks that reported position for the selected ship.

## Map sources and credits

All free, no keys. Credits also appear on screen.

- Aerial imagery: USGS The National Map, USDA NAIP orthophotos (public domain). A zoom 14 mosaic ships with the app. Sharper tiles to zoom 16 load from the USGS tile cache as you zoom.
- Close-up imagery: the USGS cache stops at about 2 m per pixel, so the app ships its own 0.5 m tiles for the terminals, the banks of the shipping channel, the marinas, Patriots Point, Fort Sumter, Castle Pinckney and the Coast Guard base. They are the same 2021 NAIP photos at full resolution, read from the public NAIP archive on Microsoft's Planetary Computer (no key) and colour-matched to the USGS tiles. They load from this app's own domain, so nothing slow is in the way.
- Roads, terminals, piers, cranes, bridges, buoys, water outlines: OpenStreetMap contributors (ODbL), via the Overpass API.
- Shipping channel outline and reach names: US Army Corps of Engineers, National Channel Framework (public domain).
- Sun and moon positions: computed in the browser.

The files under `public/data` are built from those sources by the scripts in `tools/`. The night lights are placed along the real road network and inside the real terminal outlines. Individual lamp positions are typical spacing, not surveyed lamps.

## Honest limits

- AIS gives a broad type only. Vessels whose type names their kind (tanker, passenger, tug, pilot, sailing, pleasure craft, fishing, dredger, military, law enforcement, rescue) are drawn from it. For cargo ships the model (container ship, car carrier, bulk carrier, general cargo) is an estimate from the name, the berth and the size, and the card says which. A vessel with no usable type is drawn as a plain workboat or small motor boat, and the card says that too.
- A vessel that reports no hull size is drawn at a typical size for its kind. The card shows its size as unknown and says the drawn size is a stand-in.
- Paint schemes, container loads and deck details are generic for each kind of ship. AIS does not describe them.
- Close-up imagery is 0.5 m per pixel around the port (see above). Away from the terminals and the channel the deepest imagery is about 2 m per pixel, so that land is soft at the closest zoom.
- Some transponders report no heading. A stationary ship with no heading is drawn lying along its wharf, or the way its hull fits the open water around it, and the card says so. Bow and stern may be swapped in that case.
- A moored hull that GPS error would place partly on a wharf or dock is moved the shortest way off it, by at most 30 m. A moored boat that reports no heading is drawn lying along its dock.
- Docks and piers are drawn as plain slabs from their OpenStreetMap lines, with widths measured on the photo for the longer ones. The photo is left out for them because it shows every boat that was tied up on the day it was flown. Docks missing from OpenStreetMap are missing here.
- A small craft that has no track and whose last two reports are on opposite sides of land is moved in one step, so it is never drawn sailing over land.
- Not for navigation.

## Layout

```
api/harbor.js        serverless function: ships, tracks, tide, air gap
lib/vessels.js       AIS field handling shared by the function and the page
src/main.js          page start-up and frame loop
src/scene/           camera, imagery and water shader, lights, cranes, ships
src/ships/           the 3D vessel models
src/ui/              side panel, ship card, map labels
src/astro.js         sun and moon
public/data/         imagery mosaic, water mask, lights, harbor features
public/hires/        sharp close-up imagery tiles for the port areas
tools/               scripts that build public/data and public/hires
```

## Rebuilding the map data

Only needed to refresh the imagery or the OpenStreetMap features. Needs Python 3 with Pillow, NumPy and SciPy. The close-up tiles also need rasterio.

```bash
python3 tools/fetch_imagery.py 14
```

```bash
python3 tools/fetch_osm.py
```

```bash
python3 tools/fetch_usace.py
```

```bash
python3 tools/build_water.py
```

```bash
python3 tools/build_features.py
```

```bash
python3 tools/build_lights.py
```

```bash
python3 tools/build_hires.py
```

## Deploy

The folder is a self-contained Vite app with one function. Deployed with the Vercel CLI from inside this folder, so this folder is the project root:

```bash
vercel link --yes --project harbor-claude-code-fable-5.2-xhigh
```

```bash
vercel deploy --prod
```

No environment variables are needed.

# Charleston Harbor, live ships

An overhead view of the large ships in Charleston Harbor, South Carolina, drawn over real aerial imagery with live AIS positions, live tide and live Ravenel Bridge clearance.

- Built by: Claude Code, model Fable 5.2, effort xhigh
- Folder: `claude-code-fable-5.2-xhigh`
- Vercel project: `harbor-claude-code-fable-5.2-xhigh`
- Live URL: https://harbor-claude-code-fable-52-xhigh.vercel.app

## What you see

- The whole harbor from the jetties to the Wando Welch and North Charleston terminals, north up, on USGS aerial photos.
- Every vessel as a 3D model of its kind, scaled to its reported length and beam and turned to its heading: container ships, tankers, car carriers, bulk carriers, cruise ships, tugs, pilot boats, and also sailing yachts, motor yachts, fishing boats, patrol and rescue boats, workboats and dredges. The Layers panel hides the small craft.
- Night view with street, terminal, bridge, crane and dock lights, and navigation lights on every ship: red to port, green to starboard, white masthead and stern lights. Day view with the real sun direction and shadows.
- The view follows Charleston's real sunrise and sunset. The Auto, Day and Night buttons hold either view.
- A side panel with the ships at each container terminal, ships under way, other berths, the tide at Charleston and the clearance under the Ravenel Bridge.
- Select a ship for a small card: name, speed, kind and flag, then plain facts worked out from its report. Where it is bound, how far that is by sea and how long it would take. How much water is under its keel right now. How long it is next to a football field, the Ravenel Bridge and the Yorktown. "More details" adds the full report, a plan drawing, and the ship's backstory with a photo when Wikidata has one. A missing field reads "unknown".
- The card never covers the ship. On a desktop it sits in a corner and the map centres the ship in the open part. On a phone the map fills the screen, the card is a short sheet at the bottom, and the ship is centred above it.
- A Layers button switches each thing on or off, and the browser remembers the choice: ship names, small craft, the shipping channel, buoys and beacons, tidal currents, landmarks, shipwrecks, dolphin sightings, and on the board the weather, marine alerts, ships arriving from sea and the harbor log.
- Buoys and beacons from the NOAA chart, modelled at real size. At night each light flashes its charted colour and rhythm, and the Sullivan's Island lighthouse shows its two flashes every 30 seconds.
- Wind, water and air temperature and pressure at the Charleston tide station, and arrows for the predicted tidal current at eight points along the channel.
- The National Weather Service marine forecast for the harbor, with any active advisory shown on the board and as a chip on the map.
- Ships arriving from sea: large ships outside the jetties that are heading for the entrance, with distance and an estimated time at the jetties.
- A harbor log of arrivals, departures and the biggest ship of each day, kept for a week.
- Pins for 12 landmarks, 4 wrecks with a story (the Housatonic, the Hunley, the Patapsco, the Georgiana) and every wreck on the NOAA chart, and recent dolphin sightings from iNaturalist.

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

The browser calls three endpoints in this app every 10 minutes: `/api/harbor` (ships, tide, bridge), `/api/extras` (weather, currents, alerts, arriving ships, dolphins) and `/api/log` (the harbor log). It calls `/api/ship?imo=N` once when a ship's details are opened. Those serverless functions call the sources, so the browser never depends on them directly. The same data code runs as a Vercel function and as a Cloudflare Worker. None of the sources needs a key, and the function sends the User-Agent `harbor-bench/1.0`.

| Data | Source |
| --- | --- |
| Ship positions and details | Open Waters AIS, `GET https://ais.openwaters.io/v1/vessels?bbox=32.70,-80.05,32.95,-79.75` |
| Track of each ship that is under way | Open Waters AIS, `/v1/vessels/{mmsi}/track` |
| Water level and tide predictions | NOAA CO-OPS station 8665530, Charleston |
| Bridge clearance (air gap) | NOAA CO-OPS station 8665353, Ravenel Bridge |
| Wind, water and air temperature, pressure | NOAA CO-OPS station 8665530, newest reading of each |
| Tidal currents | NOAA CO-OPS current predictions (slack and peak times) for stations ACT6636, ACT6651, ACT6701, ACT6751, ACT6761, ACT6781, ACT6806 and ACT6906 |
| Marine forecast and alerts | National Weather Service, the Charleston coastal waters forecast and active alerts for the harbor zone (AMZ340), `api.weather.gov` |
| Ships arriving from sea | Open Waters AIS, a wider box off the coast |
| Dolphin sightings | iNaturalist, bottlenose dolphin observations with open positions in the last 90 days |
| Ship backstory | Wikidata, looked up by IMO number. Photos from Wikimedia Commons |
| Harbor log | Kept by this app. On Cloudflare a timer notes the large ships in the harbor every 10 minutes and stores a week of days in Workers KV |

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
- Close-up imagery: the USGS cache stops at about 2 m per pixel, so the app ships its own 0.5 m tiles for the terminals, the banks of the shipping channel, the marinas, Patriots Point, Fort Sumter, Castle Pinckney, the Coast Guard base, the Fort Johnson boat slip, Shem Creek and Toler's Cove. They are the same 2021 NAIP photos at full resolution, read from the public NAIP archive on Microsoft's Planetary Computer (no key) and colour-matched to the USGS tiles. They load from this app's own domain, so nothing slow is in the way.
- Roads, terminals, piers, cranes, bridges, buoys, water outlines: OpenStreetMap contributors (ODbL), via the Overpass API.
- Shipping channel outline and reach names: US Army Corps of Engineers, National Channel Framework (public domain).
- Buoys, beacons, lights with their flash sequences, and charted wrecks: NOAA Office of Coast Survey, ENC Direct to GIS (public domain), stored in `public/data/chart.json`.
- Landmark and wreck stories: written for this app from well known history. Each card links to Wikipedia.
- Sun and moon positions: computed in the browser.

The files under `public/data` are built from those sources by the scripts in `tools/`. The night lights are placed along the real road network and inside the real terminal outlines. Individual lamp positions are typical spacing, not surveyed lamps.

## Honest limits

- AIS gives a broad type only. Vessels whose type names their kind (tanker, passenger, tug, pilot, sailing, pleasure craft, fishing, dredger, military, law enforcement, rescue) are drawn from it. For cargo ships the model (container ship, car carrier, bulk carrier, general cargo) is an estimate from the name, the berth and the size, and the card says which. A vessel with no usable type is drawn as a plain workboat or small motor boat, and the card says that too.
- A vessel that reports no hull size is drawn at a typical size for its kind. The card shows its size as unknown and says the drawn size is a stand-in.
- Paint schemes, container loads and deck details are generic for each kind of ship. AIS does not describe them.
- Three things are drawn to keep ships easy to pick out, and a real photo would show none of them: a pale strip round the edge of each ship's deck, a soft band on the water round every hull (dark by day, pale at night), and a plate behind the selected ship's name. The 3D cranes, masts and other thin spars cast no shadow, because those shadows hid the ships. When the Day view is held at night, the stand-in sun sits 55 degrees up in the southeast.
- Close-up imagery is 0.5 m per pixel around the port (see above). Away from the terminals and the channel the deepest imagery is about 2 m per pixel, so that land is soft at the closest zoom.
- Some transponders report no heading. A stationary vessel with no heading is drawn lying along its wharf or dock. Away from a dock it lies along the walls of the slip, creek or quay it sits in, found by following open water from its position until it meets land. In open water it takes the heading of a close neighbour that reports one, or the way its hull best fits the water around it. The card says which, and bow and stern may be swapped.
- A moored hull that GPS error would place partly on a wharf, a dock or the shore is moved the shortest way off it, by at most 30 m. Where a boat with no heading could lie along more than one dock face, each is tried and the pose that needs the shortest move and puts the most of the hull alongside is kept.
- Two moored hulls that the reports would draw on top of each other are pushed apart by the shortest move. The smaller one gives way, and neither is pushed back onto a dock. When a vessel is drawn 3 m or more from its reported position, its card says how far.
- A moving vessel follows the track it reported. Where that track runs through another drawn hull, the two are held apart for as long as they would overlap: the smaller one gives way, and a moving boat steers round a moored one of its own size.
- Some yacht owners type their boat's size into the transponder in feet. A sailing or pleasure craft is read as feet only when its size cannot be a real hull in metres: 30 m or longer, no IMO number, no draught, and far too wide for its length. The card shows the reported figures and the drawn size. Every other size is drawn exactly as reported.
- Docks and piers are drawn as plain slabs from their OpenStreetMap lines and outlines, with widths measured on the photo for the longer lines. The photo is left out for them because it shows every boat that was tied up on the day it was flown. Docks missing from OpenStreetMap are missing here.
- A small craft that has no track and whose last two reports are on opposite sides of land is moved in one step, so it is never drawn sailing over land.
- Tidal currents are NOAA predictions, not measurements. Charleston has no real-time current meter. The speed between a slack and a peak is a smooth curve between the two predicted values. Wind and river flow change the real current.
- Water under the keel is the channel's maintained depth where the ship is, plus the tide now, less the draught the crew typed into the transponder. It is shown only inside the dredged channel, where the depth is known, and a shoaled channel or a wrong draught makes it wrong.
- Distance to a destination is a rough sea route through a few turning points (round Florida, through Panama, Gibraltar, Suez or Malacca), not a routed voyage. Travel time uses the ship's speed now, or 16 knots when it is not moving. A destination the crew typed in a form the port table does not know is shown as typed.
- Ships arriving from sea are only those the AIS network can hear, which is roughly 20 to 40 nautical miles out. The time at the jetties is distance over speed now.
- The harbor log starts empty and sees the harbor once every 10 minutes, so a ship that comes and goes inside 10 minutes is missed. On Vercel there is no log, because nothing there keeps it.
- Positions of the four historic wrecks are approximate. Charted wrecks come from the NOAA chart with no names. Dolphin sightings are what people chose to report, at the accuracy they reported.
- A ship has a backstory only if Wikidata has an entry with its IMO number. Most do not.
- Not for navigation.

## Layout

```
api/                 the data endpoints as Vercel functions: harbor, extras, ship, log
worker/index.js      the same endpoints as a Cloudflare Worker, and the timer that keeps the log
lib/harbor.js        ships, tracks, tide, air gap
lib/extras.js        weather, currents, marine forecast and alerts, arriving ships, dolphins
lib/ship.js          a ship's backstory from Wikidata
lib/log.js           the harbor log
lib/vessels.js       AIS field handling shared by the function and the page
wrangler.jsonc       Cloudflare config
src/main.js          page start-up and frame loop
src/scene/           camera, imagery and water shader, lights, cranes, ships
src/ships/           the 3D vessel models
src/ui/              side panel, ship card, map labels, pins
src/layers.js        the Layers panel
src/facts.js         under-keel water, destination and distance, size comparisons, current now
src/ports.js         port codes and names that ships type as a destination
src/places.js        landmarks and wreck stories
src/astro.js         sun and moon
public/data/         imagery mosaic, water mask, lights, harbor features
public/hires/        sharp close-up imagery tiles for the port areas
tools/               scripts that build public/data and public/hires
```

## Rebuilding the map data

`tools/build_chart.py` builds `public/data/chart.json` (buoys, beacons, lights, wrecks) from NOAA ENC Direct. The file in the repository was made from the same service on 2026-11-23.

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

## Deploy to Vercel

The folder is a self-contained Vite app with one function. Deployed with the Vercel CLI from inside this folder, so this folder is the project root:

```bash
vercel link --yes --project harbor-claude-code-fable-5.2-xhigh
```

```bash
vercel deploy --prod
```

No environment variables are needed.

## Deploy to Cloudflare

The same folder deploys to Cloudflare Workers. Cloudflare serves the built site (`dist/`) as static files and runs `worker/index.js` for `/api/*`. The settings are in `wrangler.jsonc`, and the cache rules for the static files are in `public/_headers`.

From GitHub, with Workers Builds: in the Cloudflare dashboard open Workers & Pages, create an application from the GitHub repository, and use these settings.

| Setting | Value |
| --- | --- |
| Project name | `harbor-claude-code-fable-52-xhigh` (it must match `name` in `wrangler.jsonc`) |
| Branch | `deploy` |
| Root directory | `claude-code-fable-5.2-xhigh` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

From a machine instead:

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npm run cf:deploy
```

To run it locally the way Cloudflare does, at http://localhost:8787 (the script marks the run as local so it is not redirected to https):

```bash
npm run cf:dev
```

The site's address, `charlestonharborwatch.com` (with and without `www`), is set under `routes` in `wrangler.jsonc`. Cloudflare creates the DNS records and certificates on deploy. The domain has to be a zone on the same Cloudflare account, so anyone deploying a copy elsewhere should change or remove those two lines.

How the Cloudflare deploy is locked down:

- One address only. Plain http and the `www` name are redirected to `https://charlestonharborwatch.com`, and the `workers.dev` and preview addresses are switched off.
- Security headers on every static file (`public/_headers`): a content security policy that allows only the site's own code, styles and fonts, plus USGS map tiles and Wikimedia Commons ship photos as images; no framing; no MIME sniffing; HSTS; a tight permissions policy.
- The data endpoints answer GET and HEAD only, send no cross-origin headers, and keep each finished answer in Cloudflare's cache (ships 20 seconds, weather and the rest 5 minutes, the log 1 minute, a ship's backstory 7 days), so however often they are called the sources are asked about once per period per Cloudflare location.
- The ship lookup accepts only a valid seven digit IMO number, and only links to Wikipedia, Wikidata and Wikimedia Commons are passed on to the page.
- Nothing secret exists to leak: no keys, tokens or environment variables.

No environment variables or secrets are needed. It fits the Workers Free plan: static files are served free, and only `/api/*` and the timer run the Worker. That plan allows 50 outgoing calls per request, so on Cloudflare the endpoint fetches tracks for up to 32 moving vessels where Vercel fetches 40. A warm Worker shares one finished answer for 20 seconds.

The harbor log needs one Workers KV namespace and a timer. Both are declared in `wrangler.jsonc`: the `HARBOR_LOG` binding has no id, so `wrangler deploy` creates the namespace on the first deploy, and the cron trigger runs the Worker every 10 minutes. With Workers Builds, the build token needs permission to edit Workers KV. The timer makes about 150 KV writes a day, well inside the free 1,000. If the namespace is missing the app still runs and the log reads "not set up".

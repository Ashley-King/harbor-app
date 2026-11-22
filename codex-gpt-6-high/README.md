# Charleston Harbor Observatory

A self-contained React / Vite app with Vercel serverless functions, MapLibre aerial mapping and procedural Three.js vessels. Everything for this implementation lives in `codex-gpt-6-high/`.

## Run locally

Requires Node.js 22 or newer.

```sh
cd ~/side-projects/harbor-app/codex-gpt-6-high
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite development server also runs the same serverless handlers used in production. No keys or environment variables are required.

```sh
npm run verify
```

This runs the feed-recovery / normalization tests and the production build. `npm run preview` previews the static build; use the development server or a Vercel deployment when live serverless routes are needed. `scripts/browser-check.mjs` runs isolated headless Chrome checks against `TEST_URL` (defaults to the development server) and writes ignored artifacts inside this folder. Its executable path targets Chrome on macOS.

## Vercel

Live app: [harbor-codex-gpt-6-high.vercel.app](https://harbor-codex-gpt-6-high.vercel.app)

| Setting | Value |
| --- | --- |
| Project | `harbor-codex-gpt-6-high` |
| Git root directory | `codex-gpt-6-high` |
| Framework | Vite |
| Install | `npm ci` |
| Build | `npm run build` |
| Output | `dist` |

The project is independent of the other implementations in the shared repository. It has no application secrets and needs no Vercel environment variables. A Vercel deployment access token is an operator credential only; never add it to the app or its environment variables. Production is deployed directly from this folder’s committed files through the Vercel deployment API, with the project root above. The account does not have the GitHub integration installed, so a Git push alone does not publish a new version. The upload includes only this implementation’s tracked files, with no other model folders or repository-root files.

## Live observations

The browser calls only this app's `/api/harbor` for AIS and NOAA data. It refreshes automatically every ten minutes, without reloading, and when a backgrounded tab becomes visible. A manual refresh is also available. Each source has its own fetch timestamp and status. Vessel report times and NOAA observation times are displayed separately, in Charleston local time.

- [Open Waters AIS](https://openwaters.io/api/ais/): the requested Charleston bounding box, with `max_age=30m` to exclude historical stationary reports. The default upstream endpoint otherwise permits stationary reports up to seven days old. Both server and client preserve the last successful response on failure. An empty successful response clears ships that are no longer reported. Only AIS types 60–89, vessels longer than 150 m, and tug / pilot codes 31, 32, 50, 52 are displayed. Other traffic is hidden.
- Open Waters vessel-detail requests refine subtype when registered particulars are available. Positions and timestamps always come from the current snapshot. Optional detail calls have short timeouts and a bounded worker pool. The source User-Agent is `harbor-bench/1.0`, with no contact email.
- [NOAA CO-OPS](https://api.tidesandcurrents.noaa.gov/api/prod/): measured water level at 8665530, in feet above MLLW, including a 24-hour observation trace; measured air gap at 8665353, Ravenel Bridge, in feet. NOAA flags are retained; flagged air gap readings are identified. Observation age above 20 minutes is stale.

The server retains last-good observations in warm process memory. The browser additionally keeps its last-good observations in local storage, so a serverless cold start or browser reload does not erase already observed traffic. No snapshot is baked into the build. On a first-ever visit during an outage, unavailable values remain unknown and no ships are generated. A successful response also becomes stale if its fetch time ages beyond the refresh interval plus one minute. The upstream service's geographic coverage, AIS transmissions, reported particulars and data quality determine what can be shown.

## Aerial view and ships

[USGS The National Map / USDA NAIP](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer) supplies free public aerial imagery through the app's restricted `/api/imagery` proxy. Credit appears on the map. Imagery is historical; boats photographed in the basemap are not current vessel observations. Offshore imagery coverage can end at tile boundaries. Map annotations identify Ravenel and Don Holt bridges, the shipping channel, Wando Welch, North Charleston, Leatherman and Columbus Street terminals. [SC Ports](https://scspa.com/facilities/) and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) are the terminal-reference sources; Columbus Street is a Ro/Ro and breakbulk terminal.

Each reported vessel has a clickable target and a card with name, flag, IMO, AIS type, length, beam, speed, destination, ETA, draught and report time. Missing fields say `unknown`. Raw AIS ETA is shown in UTC without inventing its missing year. The map uses reported true heading, falling back to course when available. It accounts for AIS antenna offsets when supplied. Reported length and beam scale the mesh in geographic metres. Missing or saturated dimensions do not produce a falsely scaled hull; reported values and warnings remain in the card.

The models support container stacks, tanker manifolds and pipes, Ro/Ro superstructures, bulk hatches, passenger / cruise decks, and small tug / pilot boats. AIS cargo codes do not specify an exact cargo subtype. When registered particulars cannot resolve it, a generic cargo hull is used and labeled accordingly. Mesh appearance is illustrative; it is not a digital scan of each named vessel. Red port, green starboard and white masthead / stern light positions appear in night mode. The display does not assess complete navigation-light signals or infer vessel operations from them.

Position updates interpolate over 20 seconds and then stop at the reported coordinate. The app does not extrapolate motion into unreported positions. Short fading wakes are decorative, derived from reported speed/course, and are not recorded tracks. Reduced-motion preferences are respected. Stationary reports within 350 metres of a mapped berth appear in that terminal's list. These proximity groups are approximate, not port-confirmed assignments. Bridge, crane and shoreline lights are architectural illustrations rather than a live lighting feed. The channel line is a schematic guide, not a navigational chart.

## Lighting

The first visit opens in night mode. Manual Day / Night overrides last until the next Charleston sunrise or sunset, then return to automatic solar mode. Auto follows the current solar state immediately. [SunCalc](https://github.com/mourner/suncalc) calculates the solar times for Charleston; the UI always formats time in `America/New_York`, independently of the viewer's timezone.

## Safety and scope

No sample ships are included in application code. Test fixtures exist only under `tests/` and are never imported into the app. The imagery proxy accepts only numeric tiles near Charleston and fixed upstream hosts; it cannot be used as an arbitrary URL proxy. `.env*`, `.vercel`, `node_modules`, build output, caches, screenshots and logs are ignored. Live feed responses are not committed.

This is an exploratory harbor display, not a navigation or bridge-clearance decision system.

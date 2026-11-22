# Charleston Harbor Watch

A north-up aerial map of Charleston Harbor, South Carolina, with live AIS contacts, approximate terminal berth matches, NOAA tide and bridge observations, and day and night rendering.

## Local development

Requires Node.js 22 and an internet connection. From this folder:

```sh
npm ci
npm run dev
```

Open the local address Vite prints. `npm run build` produces the static frontend in `dist`. `npm run preview` serves the built frontend with the same live API handler. Vercel serves the frontend and runs `api/harbor.js` as a Node.js function. Set the Vercel project root to `codex-gpt-6-2-sol-xhigh`. The app uses no API keys or runtime environment variables.

## Sources and interpretation

- [Open Waters AIS](https://openwaters.io/api/ais/) supplies positions and reported vessel fields for `32.70,-80.05,32.95,-79.75`. The view includes types 60–89, ships longer than 150 m, and tugs, towing vessels and pilot boats. It requests reports from the last 90 minutes, with Open Waters’ 30-minute limit for moving vessels. Reports at least 20 minutes old are shown faded. The timestamp in the details card is the upstream report time.
- [NOAA CO-OPS](https://api.tidesandcurrents.noaa.gov/api/prod/) provides the latest observed tide at Charleston station `8665530` in feet relative to MLLW and the measured air gap at Ravenel Bridge station `8665353` in feet.
- [South Carolina RFA](https://www.rfa.sc.gov/resources/mapping/statewide-aerial-imagery) supplies 2023 aerial imagery. [Esri World Imagery](https://www.esri.com/en-us/legal/terms/data-attributions) fills areas outside the state imagery. At overview zooms Esri imagery avoids joins where the state mosaic stops at the coast. The night view grades the daytime photography and overlays simulated infrastructure lighting. Any vessels visible in the photography are historical imagery. Live vessels are the interactive overlays.
- [NOAA ENC Direct to GIS](https://www.nauticalcharts.noaa.gov/learn/encdirect/) supplies the channel overlay, drawn from named dredged areas in the Harbor map service. Berth areas are estimates from the waterfront and [South Carolina Ports’ terminal information](https://scspa.com/facilities/wando-welch-terminal/). A berth listing means a stationary AIS position was close to a terminal wharf. This is a visualization for general interest. Use official charts and observations for navigation.
- Three.js renders the procedural vessel models from above using the AIS length, beam and heading, falling back to course when heading is unavailable. When scale or direction is unknown, a map contact marks the reported position. AIS codes describe broad classes. An available subtype guides the model. The [MARAD reserve fleet register](https://www.maritime.dot.gov/sites/marad.dot.gov/files/2026-08/2026_07%20Public%20NDRF%20Inventory.pdf) and [Coast Guard COFR register](https://www.uscg.mil/Portals/0/NPFC/COFR/COFR%20Vsl%20Status%20Report.pdf) provide some supplemental static classes. Otherwise the model uses the broad class or recognizable container operator, with generic deck geometry when the type is uncertain. Lighting and wakes are illustrative. A wake indicates reported motion. Markers animate between successive fixes and do not predict positions beyond the most recent report.

The browser fetches `/api/harbor` on load and every ten minutes. The three source feeds fail independently. Each browser stores its own last successful observations for failed requests and reloads, and a warm function can also return its last successful data. A fresh browser with an unavailable feed shows the unavailable state until a request succeeds. The first visit starts in night mode, then follows computed sunrise and sunset in Charleston. Selecting Auto applies the local solar schedule immediately. The day and night buttons override Auto and are remembered in that browser.

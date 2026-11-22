# Soundings — Charleston Harbor

An overhead ship atlas for Charleston, South Carolina. The view spans the entrance jetties, the Cooper and Wando rivers, four SC Ports terminals, and the Ravenel and Don Holt bridges.

## Run locally

Use Node.js 22 and run these commands from this folder.

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Vite serves the same API handlers used on Vercel. Internet access is needed for live reports. Run `npm run build` for the production frontend. No API keys are needed.

## Using the atlas

- Click a ship on the map or in the register to zoom to its report and inspect its particulars. Use the frame button below the zoom controls to return to the whole harbor.
- Open **Terminals** to list ships alongside each berth. Click **Map layers** to control landmarks, the channel outline, and workboats.
- The first visit starts at night and follows Charleston's next sunrise or sunset. **Auto** applies the current solar time immediately. The sun and moon buttons select a persistent manual override.
- The full-screen control is available in desktop browsers that support the Fullscreen API.

## Data and rendering

- **Ships.** The server calls [Open Waters AIS](https://openwaters.io/api/ais/) for the requested bounding box. The 30-minute age limit applies to moving and stationary vessels. Types 60–89, reported lengths over 150 metres, tugs, towing vessels and pilot boats qualify. A missing name, dimension or voyage field displays as unknown. Speed and dimensions are self-reported and can contain errors. ETA is the AIS month, day and UTC time, with no inferred year.
- **Ship models.** Three.js renders lit, orthographic models for container, tanker, bulk, vehicle, cruise, passenger and workboat classes. Open Waters' registered particulars supply subtypes where available. For unresolved classes, an exact IMO match in the [European Maritime Safety Agency’s public THETIS-MRV records](https://mrv.emsa.europa.eu/#public/emission-report) supplies the reported ship type. The app uses a general hull when a more specific class is unavailable. Antenna offsets locate each hull on its fix. A known heading, or the course of a moving vessel, orients the model. Small markers help locate vessels at harbor scale. Motion interpolates between two received fixes, with no dead reckoning beyond the latest report.
- **Conditions.** The server retrieves eight hours of observed [NOAA CO-OPS](https://api.tidesandcurrents.noaa.gov/api/prod/) water levels at Charleston (8665530, feet above MLLW) and measured Ravenel air gap (8665353, feet). Each plot and timestamp belongs to its own instrument.
- **Freshness.** An open page requests all feeds every ten minutes and checks again after waking. Each successful feed is retained separately in the browser and in warm function memory. A failure preserves the last successful result with its timestamp and a stale indicator. A first visit during a cold-start outage can show unavailable. The build contains no vessel reports.
- **Imagery.** The overview contains modified Copernicus Sentinel-2 imagery (13 November 2026, granules 17SNS and 17SPS) from [Earth Search](https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a). Close views request [USGS / USDA aerial photography](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer) through the restricted imagery function. The satellite overview stays underneath while aerial tiles load. Night illumination is simulated from the image texture and mapped structures. The background photography was captured independently of live AIS.
- **Channel and terminals.** Channel boundaries come from the [USACE National Channel Framework](https://spatial.usace.army.mil/opjarcgis/rest/services/eHydroPub/National_Channel_Framework/MapServer/1). The four [SC Ports facilities](https://scspa.com/facilities/) use approximate berth-face segments traced from the imagery. A vessel within 185 m of the segment at 0.7 knots or slower is listed alongside. A moored report can qualify when speed is unavailable. These are proximity estimates for visualization.

## Deployment

The standalone Vercel project is `harbor-codex-gpt-6.2-astra-xhigh` with repository root directory `codex-gpt-6.2-astra-xhigh`, the Vite preset, and output directory `dist`. The two Node.js functions are in `api/`. Deployment credentials are used only by the publishing shell. The app has no credential or environment-variable dependency.

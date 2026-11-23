# Harbor App

A one-shot eval of AI coding agents. Seven agent, model and effort combinations got the same prompt: build a live, photorealistic overhead view of the large ships in Charleston Harbor, South Carolina, and deploy it to the web. There were no mockups, no design notes and no follow-up coaching. Each folder holds what one setup shipped.

Built and run by [Ashley](https://ashleyk.dev).

## How it works

- Every run got the prompt below, word for word, on November 22, 2026.
- Each agent worked only in its own folder, named `<agent>-<model>-<effort>`.
- Each folder is a self-contained app with its own `package.json` and README, deployed to Vercel as its own project.
- The apps use free, keyless live data: ship positions from Open Waters AIS, plus tide and Ravenel Bridge clearance from NOAA CO-OPS.
- The repo is public, so the prompt bans secrets of any kind. No folder needs an API key.

## The lineup

| Folder | Agent | Model | Effort | Live app |
| --- | --- | --- | --- | --- |
| [`claude-code-fable-5.2-medium`](claude-code-fable-5.2-medium) | Claude Code | Fable 5.2 | medium | [harbor-claude-code-fable-52-medium.vercel.app](https://harbor-claude-code-fable-52-medium.vercel.app) |
| [`claude-code-fable-5.2-xhigh`](claude-code-fable-5.2-xhigh) | Claude Code | Fable 5.2 | xhigh | [harbor-claude-code-fable-52-xhigh.vercel.app](https://harbor-claude-code-fable-52-xhigh.vercel.app) |
| [`claude-code-opus-5.5-medium`](claude-code-opus-5.5-medium) | Claude Code | Opus 5.5 | medium | [harbor-claude-code-opus-55-medium.vercel.app](https://harbor-claude-code-opus-55-medium.vercel.app) |
| [`codex-gpt-6-high`](codex-gpt-6-high) | Codex | GPT-6 | high | [harbor-codex-gpt-6-high.vercel.app](https://harbor-codex-gpt-6-high.vercel.app) |
| [`codex-gpt-6-2-sol-xhigh`](codex-gpt-6-2-sol-xhigh) | Codex | GPT-6.2 Sol | xhigh | [harbor-codex-gpt-6-2-sol-xhigh.vercel.app](https://harbor-codex-gpt-6-2-sol-xhigh.vercel.app) |
| [`codex-gpt-6.2-astra-xhigh`](codex-gpt-6.2-astra-xhigh) | Codex | GPT-6.2 Astra | xhigh | [harbor-codex-gpt-62-astra-xhigh.vercel.app](https://harbor-codex-gpt-62-astra-xhigh.vercel.app) |
| [`grok-4.7-high`](grok-4.7-high) | Grok | Grok 4.7 | high | [harbor-grok-47-high.vercel.app](https://harbor-grok-47-high.vercel.app) |

Some folders got small fixes after the first run. The commit history shows what changed and when.

## Work in progress

The Fable 5.2 xhigh app is being extended past the eval into a full harbor site at [charlestonharborwatch.com](https://charlestonharborwatch.com). It adds harbor facts, map layers, weather, currents, alerts and a harbor log. That work lives on its own branches, so the eval folders on `main` stay close to what each model shipped.

## The prompt

The password manager item name in the deploy step is removed. Everything else is exactly what each agent received.

```text
Build a web app that shows the large ships in Charleston Harbor, South Carolina, from an overhead view, as photorealistic as possible, and deploy it to Vercel so it can be viewed online.

Where to work (follow exactly):
- The shared repo is ~/side-projects/harbor-app. It is a PUBLIC GitHub repo shared by several AI models. Each model works only in its own folder.
- Create your folder at ~/side-projects/harbor-app/<agent>-<model>-<effort>, all lowercase with hyphens. Example: grok-4-high or claude-opus-5.5-medium. Use your real agent name, model name and effort level.
- Put ALL of your work in that folder, including code, README, data files and config. Do not create, edit or delete anything outside your folder, including other models' folders and the repo root.
- Your folder must be a self-contained app with its own package.json and README.

Deploy:
- Deploy your folder to Vercel as its own project, with the root directory set to your folder. Name the project harbor-<agent>-<model>-<effort>.
- To deploy, use the Vercel access token saved in my password manager. Load it only into your shell session (for example as VERCEL_TOKEN for the Vercel CLI). Never print it, paste it into chat, commit it, write it to any file, or add it to the app's Vercel environment variables.
- When done, give me the live Vercel URL and confirm it loads and shows current ships.

Security (the repo is public):
- Commit no secrets: no API keys, tokens, passwords, emails, .env files, or personal info.
- Add a .gitignore in your folder that excludes .env*, .vercel and node_modules.
- If anything ever needs a key, read it from Vercel environment variables and never commit it. Prefer sources that need no key at all.
- For the User-Agent contact, use a placeholder like "harbor-bench/1.0" with no email address.
- Before committing, check the files you're adding for anything sensitive.

Live data:
- Always show the CURRENT ships in the harbor. No sample, cached-from-build or made-up data.
- Fetch through a Vercel serverless function in your app, which calls the data sources so the browser never depends on them directly.
- Refresh automatically every 10 minutes without reloading the page, and show when the data was last updated.
- Move ships smoothly to their new positions between updates.

Data sources (free only, no paid APIs):
- Ship positions from Open Waters AIS: GET https://ais.openwaters.io/v1/vessels?bbox=32.70,-80.05,32.95,-79.75 (GeoJSON, no key; send a User-Agent like "harbor-bench/1.0"). Read https://openwaters.io/api/ais/ before coding.
- Tide and bridge clearance from NOAA CO-OPS: water level at station 8665530 and air gap at station 8665353 (Ravenel Bridge), also refreshed every 10 minutes.

Look and feel:
- Overhead, map-style view of the whole harbor, from the jetties to the Wando Welch and North Charleston terminals.
- Photorealistic: real aerial or satellite imagery for land and water (free sources only, credited on screen), realistic water, shadows and lighting.
- Night mode by default: dark colors, with lights on. Ships show correct navigation lights (red port side, green starboard side, white masthead and stern lights), and the Ravenel and Don Holt bridges, terminals, cranes and shoreline are lit.
- A day (light) mode too. Switch automatically at Charleston's real sunrise and sunset, with a manual toggle.
- Smooth motion that still looks good on a large wall screen.
- Label the Ravenel Bridge, Don Holt Bridge, the shipping channel, and the four container terminals (Wando Welch, North Charleston, Leatherman, Columbus Street).

Ships:
- Draw each large ship (AIS types 60–89, or longer than 150 m) as a realistic top-down 3D model of its vessel type: container ships with stacked containers, tankers with deck piping and manifolds, car carriers as tall boxy hulls, bulk carriers with hatches, cruise ships with white decks and pools. Scale to the ship's true length and beam, and rotate to its heading.
- Tugs and pilot boats as small realistic boats. Fade or hide everything else.
- A short fading wake or trail behind moving ships.
- Click a ship for a card: name, flag, IMO, type, length × beam, speed, destination, ETA, draught, last report time.
- A side panel listing ships at each terminal, plus live tide and Ravenel clearance.

Rules: never invent ships or data. Show "unknown" for missing fields. If a feed fails, keep the last good data, mark it stale with its time, retry on the next refresh, and keep running.

When finished, report: your folder name, the live Vercel URL, how to run it locally, and anything you couldn't get working.
```

## More

The write-up of the results is coming to [ashleyk.dev](https://ashleyk.dev).

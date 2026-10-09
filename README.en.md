# AI WAR — AI battlefield monitor

> An unofficial, non-commercial project. Not affiliated with any of the companies shown.

**Site: <https://ukitako1030.github.io/EVAL/>** · [日本語](README.md)

![The galaxy overview: the large central planet is the general front, the planets around it are the code, agent, image, video, speech and music fronts. Standings on the right, a timeline from 2022 to now at the bottom.](mockups/shots/site-galaxy-latest.jpg)

## What it is

AI WAR shows where today's AI models stand, drawn as a war in a cyber galaxy and built from public, objective data.

- **Armies** are companies, **units** are product families (GPT, Claude, Gemini, …), and **fronts** (planets) are fields. There are seven fronts: general, code, agents, image, video, speech and music.
- **Territory = scale**: how widely a unit is used or deployed. Sources are usage announcements, web traffic rankings, OpenRouter token share and attention signals.
- **Glow and push = strength**: benchmarks and crowd votes. Sources include Arena, SWE-bench, METR, OSWorld, τ²-bench, Epoch AI, Design Arena and others.
- **Fog** marks values that are partly estimated.
- The timeline replays every month from November 2022 (ChatGPT's launch) to now. Viewers only watch; there is nothing to play.

The site's **Data & method** page lists every source, its licence and how the numbers are combined.

## How it updates

Every Monday a GitHub Actions workflow fetches the sources, recomputes `site/public/data/world.json`, runs the tests and opens a pull request. Nothing is published until a human merges it. The site itself only reads that one JSON file.

- `pipeline/`: data collection and computation (TypeScript, Node 24)
- `site/`: the website (Vite, PixiJS)

```
cd pipeline && npm ci && npm run fetch && npm run compute
cd site && npm ci && npm run dev
```

## Licence

- **Code**: MIT ([`LICENSE`](LICENSE)).
- **Data**: the MIT licence covers the code only. The data in `pipeline/raw/`, `pipeline/curated/` and `site/public/data/` stays under each source's own licence and terms ([`pipeline/raw/LICENSES.md`](pipeline/raw/LICENSES.md)). Some sources are CC BY-NC, so the data must not be used commercially.
- Company logos are not used; units are shown by name and colour. Product names are trademarks of their owners.

## Disclaimer

The numbers are computed from public data and include estimates where data is thin (shown as fog). They are not official ratings or rankings.

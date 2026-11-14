# Design notes

The dashboard is deliberately styled as a telemetry console, not a marketing landing page. Every
visual choice is tied to reading data quickly: flat surfaces, thin rules, monospaced numbers, a
single cyan accent and red reserved for anomalies. The optional Sketchfab backdrop is the only
decorative element, and it is dimmed, lazy-loaded and switchable.

## Avoiding the "vibecoded" defaults

| # | Common pattern | What this project does |
| - | -------------- | ---------------------- |
| 1 | Purple-to-blue gradient | Flat `#070b12` surface. The only gradients are neutral legibility scrims over the backdrop. |
| 2 | Gradient hero text | Solid `slate-100` heading, no text clipping or gradient fills. |
| 3 | Emojis in headings | None anywhere in the interface. |
| 4 | Inter everywhere | System sans stack for prose, system monospace for every number and label. |
| 5 | Coloured border cards | One neutral border colour (`#1b2532`) for every panel. |
| 6 | Glassmorphism | Opaque panels. No `backdrop-blur`, no translucent cards. |
| 7 | Low-contrast dark mode | Body text `slate-200/300`, secondary text raised from `slate-500` to `slate-400` for AA contrast. |
| 8 | Three icon boxes in a row | A five-cell metrics strip with uppercase labels and monospaced values, no icons. |
| 9 | Badge above the headline | Only a provenance line (`nasa smap / telemanom`) that states the mission and dataset. |
| 10 | Lucide icons everywhere | Zero icon library in the UI; the dependency was removed. |
| 11 | Untouched shadcn UI | No component framework; the layout is hand-built with Tailwind utilities. |
| 12 | Fade-in on scroll | No scroll animations at all. |
| 13 | Cursor-following beam | No pointer effects. |
| 14 | Buttons fade on hover | Hover changes colour, never opacity. |
| 15 | Inconsistent spacing | A single 4 px scale and 24 px section padding throughout. |
| 16 | Em dashes everywhere | UI copy uses periods, slashes and `+` signs. |
| 17 | Generic buzzword copy | Copy names the actual computation: threshold, persistence, tolerance, reference mean. |
| 18 | Serif italic accents | None. |
| 19 | Space Grotesk + Instrument Serif | No webfonts are loaded; system fonts only. |
| 20 | Grain over a gradient | No grain, no noise overlays. |

## The solar-system backdrop

- The scene is the Sketchfab model *Solar System* by `pinotoon`, licensed **Editorial** and
  attributed in the footer.
- It is embedded only on viewports of at least 768 px, after the telemetry request finishes and
  the browser is idle. It is unmounted while the tab is hidden and skipped under `Save-Data`.
- The embed is dimmed and pushed to the margins with a scale and translation, so it reads as a
  window into space next to the console instead of a wallpaper behind text.
- A neutral vertical scrim protects contrast; charts live on opaque panels.
- A deterministic SVG starfield (140 stars) renders underneath, so the page is complete when the
  iframe is blocked or motion is disabled.
- The `motion` control in the header pauses rotation (`autospin=0`) and is persisted in
  `localStorage`. `prefers-reduced-motion` forces it off.

## Typography and colour

| Token | Value |
| ----- | ----- |
| Page background | `#070b12` |
| Panel background | `#0b111a` |
| Rule / border | `#1b2532` |
| Primary accent | cyan `#22d3ee` (data, links, focus) |
| Alarm accent | rose `#fb7185` (threshold, anomaly windows) |
| Error series | amber `#f59e0b` |
| Neutral series | slate `#94a3b8` |

No colour is used for decoration: cyan marks interactivity and measurements, rose marks alarm state,
amber marks the residual series.

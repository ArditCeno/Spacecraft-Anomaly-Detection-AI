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
| 6 | Glassmorphism | A single frosted console layer with a neutral blur, added on request. Charts sit on darker sub-layers so contrast stays readable. No stacked translucent cards or neon edges. |
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
- The embed is dimmed and scaled so it reads as a window into space behind the frosted console,
  not as a wallpaper competing with text.
- A neutral vertical scrim protects contrast; charts live on opaque panels.
- A deterministic SVG starfield (140 stars) renders underneath, so the page is complete when the
  iframe is blocked or motion is disabled.
- The `motion` control in the header pauses rotation (`autospin=0`) and is persisted in
  `localStorage`. `prefers-reduced-motion` forces it off.

## Frosted console

The dashboard fills the viewport and the five metrics are centred. A single `backdrop-blur-lg`
layer covers the solar-system scene; chart panels and metric cells use a darker translucent
sub-layer so data never sits directly on a bright planet. The explainer dialog reuses the same
treatment with a second translucent layer for its scrolling body. This keeps the glass look
without the common failure mode of low-contrast charts over a busy backdrop.

## Guided explainer

A `What am I looking at?` button in the header opens a native `<dialog>` (focus trapping and
Escape handling come from the platform). It defines the two lines, the anomaly band, the threshold
formula, point versus episode metrics, the dataset and links to the source. The dialog shares the
frosted styling and scrolls inside the viewport.

## Observatory

Below the dashboard a full-viewport section removes the glass entirely. Only the solar-system
backdrop, a short provenance line, the license credit, a motion toggle and a return link remain.
Neutral scrims at the top and bottom blend the section into the page without covering the planets.
The backdrop is still the same fixed iframe, so scrolling reveals it instead of loading a second
scene.

## Responsive and accessibility

The console is fluid from 320 px to ultrawide. The metrics strip becomes two columns (the fifth
cell spans the row), charts stretch with responsive heights, and the diagnostics stack until
`xl`. The slider has a 24 px hit area so it remains usable on touch, and every interactive element
shows a visible cyan focus ring.

Accessibility is part of the layout, not an afterthought: skip link, `<main>` landmark, labelled
regions, `aria-live` metric summary, `role="img"` chart descriptions, native dialog semantics with
Escape handling, and reduced-motion behaviour for the backdrop and smooth scrolling. The layout was
verified at 320, 390, 768, 844 landscape and 1440 px with zero horizontal overflow.

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

# Caribbean Capital Network Platform

An agentic investment platform prototype for the Caribbean Capital Network (CCN).
The platform pairs a conversational AI investment agent with portfolio dashboards,
fund directories, and goal-based planning tools.

## Contents

### Prototypes (`*.dc.html`)

Self-contained design-code prototypes. Each is a standalone HTML document that
boots a React-based UI through the shared `support.js` runtime (loaded via
`<script src="./support.js"></script>`).

| File | Description |
| --- | --- |
| `Caribbean Capital Network.dc.html` | Primary platform prototype — portfolio dashboard, investment agent, and fund views. |
| `Caribbean Capital Network - Warm.dc.html` | Warm-themed variant with voice assistant, goals, and portfolio flows. Also available as `Caribbean Capital Network - Warm (standalone).html` — a self-contained single-file build that inlines the runtime (no `support.js`) and is the version the landing page links to. |
| `CCN Directions.dc.html` | Directions / directory view for funds and portfolios. |

### Runtime

- `support.js` — the shared `dc-runtime` bundle that parses each `<x-dc>`
  document and renders it with React. Generated from `dc-runtime/src/*.ts`
  (do not edit by hand).
- `.thumbnail` — WebP preview thumbnail of the primary prototype.

### Assets

- `screenshots/` — iteration screenshots captured while designing the dashboard,
  agent, voice, and directory views.
- `uploads/` — source references used while building the prototype (sketches,
  pasted design frames, and voice notes).

## Viewing the prototypes

Because the prototypes load `support.js` relatively, serve the directory over
HTTP rather than opening the file directly:

```bash
# from the repository root
python3 -m http.server 8000
# then open http://localhost:8000/Caribbean%20Capital%20Network.dc.html
```

The prototypes are self-contained; no build step or dependencies are required.

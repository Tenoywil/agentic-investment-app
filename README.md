# Caribbean Capital Network Platform

An agentic investment platform prototype for the Caribbean Capital Network (CCN).
The platform pairs a conversational AI investment agent with portfolio dashboards,
goal-based planning, and investment opportunity flows.

## Contents

The site is a single page: the **Warm theme** prototype, served as `index.html`.

| File | Description |
| --- | --- |
| `index.html` | The Warm-themed CCN platform prototype — landing, sign-up, home, portfolio, opportunities, agent, and planning views. Boots a React UI through the shared `support.js` runtime. |

### Runtime

- `support.js` — the shared `dc-runtime` bundle that parses the page's `<x-dc>`
  document and renders it with React (loaded from a CDN at runtime). Generated
  from `dc-runtime/src/*.ts` (do not edit by hand).
- `.thumbnail` — WebP preview thumbnail of the prototype.
- `favicon.svg` / `favicon-32.png` / `apple-touch-icon.png` — site favicon (the
  CCN "C" logo mark on the brand teal), linked from `index.html`.

### Assets

- `screenshots/` — iteration screenshots captured while designing the platform.
- `uploads/` — source references used while building the prototype (sketches,
  pasted design frames, and voice notes).

## Viewing the prototype

Because the page loads `support.js` relatively, serve the directory over HTTP
rather than opening the file directly:

```bash
# from the repository root
python3 -m http.server 8000
# then open http://localhost:8000/
```

No build step is required; `support.js` loads React at runtime, so the page
needs network access to its CDN the first time it renders.

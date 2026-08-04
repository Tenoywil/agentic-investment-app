# Infrastructure & project wiring

Cloud projects for CCN. Secrets flow **Doppler → everything** (never in source).

| Project | Purpose | Region | Notes |
| --- | --- | --- | --- |
| **Vercel** (`apps/web`) | Next.js customer + partner console + marketing | edge/global | Phase 1: `vercel.json` pins the static prototype at repo root. Phase 2 sets Root Directory = `apps/web`. |
| **Fly.io** (`apps/api`) | Bun + Hono API, agent runtime, WebSocket hub | `iad` (near Supabase us-east) | Persistent process for native WebSockets. `fly.toml` lands with `apps/api` in Phase 3. |
| **Supabase** | Postgres 15 + pgvector + Storage | `us-east-1` | Managed Postgres + Storage only — no Realtime, no Edge Functions. Orchestration data only (partner-anchored residency). |
| **Doppler** | Secrets source of truth | — | Syncs to Vercel + Fly + GitHub Actions (OIDC). Configs: `dev`/`stg`/`prd`. |

## Secret sync (set up once)

1. `doppler setup` (project `ccn`, config `dev`).
2. Doppler → Vercel integration (auto-syncs env to the web project).
3. Doppler → Fly: `doppler run -- fly secrets import` on deploy.
4. Doppler → GitHub Actions: OIDC, no long-lived cloud keys.

The env contract every service validates is in `/.env.example` and enforced by `@ccn/config`.

## Not AWS

The hackathon build uses no AWS: Storage = Supabase Storage; batch/scheduled jobs = Fly scheduled
machines; OCR = the AI gateway's vision model or `tesseract.js`; field encryption = libsodium with a
Doppler-held key. Terraform is only introduced if AWS is added later.

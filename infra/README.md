# Infrastructure & project wiring

Cloud projects for CCN. Secrets flow **Doppler → everything** (never in source).

| Project | Purpose | Region | Notes |
| --- | --- | --- | --- |
| **Vercel** (`apps/web`) | Next.js customer + partner console + marketing | edge/global | Real Next.js SSR — Root Directory is set to `apps/web` (dashboard setting) so Vercel's native Next.js + Turborepo detection builds and serves it directly; no `vercel.json` needed. Security headers live in `apps/web/next.config.mjs`'s `headers()`. |
| **Render** (`apps/api`) | Bun + Hono API, agent runtime, WebSocket hub | Ohio/Virginia (near Supabase us-east) | Persistent Docker process for native WebSockets, flat-rate pricing. `apps/api/render.yaml` is the Blueprint (swapped from Fly.io — see its header comment for why). |
| **Supabase** | Postgres 15 + pgvector + Storage | `us-east-1` | Managed Postgres + Storage only — no Realtime, no Edge Functions. Orchestration data only (partner-anchored residency). |
| **Doppler** | Secrets source of truth | — | Syncs to Vercel + Render + GitHub Actions (OIDC). Configs: `dev`/`stg`/`prd`. |

## Secret sync (set up once)

1. `doppler setup` (project `ccn`, config `dev`).
2. Doppler → Vercel integration (auto-syncs env to the web project).
3. Doppler → Render: sync via the Render dashboard's Doppler integration, or `doppler run -- <deploy command>` in the build.
4. Doppler → GitHub Actions: OIDC, no long-lived cloud keys.

The env contract every service validates is in `/.env.example` and enforced by `@ccn/config`.

## Not AWS

The hackathon build uses no AWS: Storage = Supabase Storage; batch/scheduled jobs = Render Cron Jobs;
OCR = the AI gateway's vision model or `tesseract.js`; field encryption is AES-256-GCM via Web Crypto
(`@ccn/security/field-crypto`) with a Doppler-held key — see `apps/ops/runbooks/security-posture.md`
for why this superseded the originally planned libsodium sealed boxes. Terraform is only introduced if
AWS is added later.

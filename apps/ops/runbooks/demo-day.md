# Demo day

The product is shown live. This is the sequence that gets it on screen and the
short list of things that have actually broken before.

Nothing here is aspirational — every step is either a command you can run now or
a click path someone has walked. Where a step has no verification, it says so.

## Before the room (do these the day before, not on the morning)

| # | Step | Why it is on the list |
|---|---|---|
| 1 | Set `PARTNER_OPERATOR_EMAILS`, `DEMO_CUSTOMER_EMAILS`, `DEMO_PARTNER_CODE` in the Render dashboard | Without them every Google identity provisions as a plain `customer` and the console is unreachable. `loadServerConfig` throws at startup if an address appears in both lists, so a typo fails the deploy rather than silently making the customer account an operator. |
| 2 | `cd apps/api && bun run grant` | Pre-provisions the allowlisted identities so the lazy first-sign-in path never runs in front of an audience. Calls the same `ensureProvisioned` a real sign-in calls, is idempotent, and prints the roles actually held afterwards. Exits non-zero if an allowlisted address has no account yet — sign in with it once, then re-run. |
| 3 | **Bump Render off the `free` plan** | Free sleeps after ~15 min idle and takes 30–60s to answer the first request, and drops the LISTEN/NOTIFY connection that drives realtime. This is the single highest-probability stage failure and $7 retires it. If it stays free, put an uptime pinger on `/health` at 5-minute intervals and open a tab on the app 10 minutes before. |
| 4 | Confirm `BETTER_AUTH_URL` points at the **web** origin, and that the Google console's redirect URI matches | A mismatch fails the OAuth callback with an error page rather than a redirect. |
| 5 | Sign in as both identities once, end to end | The only real proof. Steps 1–4 are the causes; this is the effect. |

## The three flows

Walk each **three times**, in a fresh private window each time. Flow 3 is the one
that gets skipped and the one most likely to be tried from the audience.

### 1 — Institution operator

1. Sign in with the operator Google account.
2. Lands on `/institutions`. **Check:** the partner name in the header and sidebar
   is the real firm from `me.partner.name`, not a placeholder.
3. **Check:** no "switch to investor view" anywhere. The only way out is Sign out.
4. Type `/home` in the address bar → bounced back to `/institutions`.
5. In devtools, `fetch('/api/portfolio')` → **403**.

### 2 — Demo customer

1. Sign in with the demo customer Google account.
2. Lands on `/home` with the seeded Caribbean portfolio.
3. **Check:** every figure on screen is one the API returned. No all-time gain, no
   yield, no holdings count, no sparkline.
4. **Check:** no "For institutions" link in the sidebar.
5. Type `/institutions` → bounced back.
6. `fetch('/api/console/kpis')` → **403**.

### 3 — A brand-new Google account, created live

This is the demo. Everything above can be rehearsed; this cannot.

1. Sign in with an account that has never touched the system.
2. Lands on `/onboarding`. Complete it.
3. Walk **every** customer screen: home, portfolio, opportunities, agent, planning,
   gateway.
4. **Check:** each one renders a designed `<EmptyState>` — not a dash, not a zero
   standing in for unknown, not a spinner that never resolves, not a `NaN`.
5. **Check:** zero invented numbers. A new account owns nothing, and the screens
   must say so deliberately.

## If something breaks on stage

| Symptom | First move |
|---|---|
| First request hangs 30–60s | Render cold start. It will answer. Keep talking; do not reload — a reload starts a second cold request. |
| "Authentication required" while signed in | The session cookie did not reach the API. The API log line `no session resolved` names which cookies arrived. Do not change cookie attributes live — this has caused an outage before (a `Partitioned` cookie keyed to the API's site and became invisible to the web origin). |
| Console returns 403 to the operator | Their role never provisioned — check `PARTNER_OPERATOR_EMAILS` spelling and that `db:grant` ran. Sign out and back in; provisioning is lazy and self-healing. |
| Agent chat produces nothing | `runAgent` has one path to text and no fallback; the response cache is per-process and cold after a deploy. Move to another screen. **Known gap, not a fixable-on-stage issue.** |
| A screen shows a number that looks wrong | It came from the API. `bun test apps/web` enforces that no component carries a hardcoded figure. |

## What is deliberately not covered

- **Automated end-to-end smoke against production.** The build sandbox has no
  egress — every outbound host returns 403 at the proxy — so production has never
  been exercised from CI or from an agent. The three flows above are manual for
  that reason, and there is no substitute.
- **Load.** One Render instance, in-memory rate limiter. Fine for a demo, not a
  claim to make about capacity.

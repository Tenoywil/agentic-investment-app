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
| 4 | Read the API's `auth configuration` line in the Render log at boot, and make sure the Google OAuth client lists the `googleRedirectUri` it prints | This is the one setting code cannot self-correct. `baseURL` decides both where Google returns the browser and which domain the session cookie belongs to; because `/api/*` is proxied, the browser is only ever on the **web** origin, so the cookie must belong there. Pointed at the API instead, sign-in *succeeds* and every request after it is anonymous — which is exactly the outage we had. The API now derives `baseURL` from `APP_WEB_ORIGIN` in production and logs `overriddenToWebOrigin: true` if `BETTER_AUTH_URL` disagrees, so only the Google redirect URI still has to be set by hand. |
| 4a | Confirm `NEXT_PUBLIC_API_URL` is **empty** on Vercel and `API_ORIGIN` is the API's origin, then **redeploy** | Both are inlined at build time, so saving them without a redeploy changes nothing. A non-empty `NEXT_PUBLIC_API_URL` sends the browser straight to the API cross-site, making the session cookie third-party; the web app now ignores an absolute value in production, but the variable should still be right. |
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
6. **Check:** the tour opens by itself on the first customer screen, and the
   "Take the tour" button at bottom-right replays it. Steps whose panel is empty
   are skipped, so a new account gets a shorter tour, not a broken one.

This flow was swept in a headless browser against an all-empty API — every
customer screen, both themes — with no page errors, no `NaN`/`undefined`, and no
placeholder glyphs. That is not a substitute for walking it on production, but it
means a failure here is an environment problem, not a UI one.

## If something breaks on stage

| Symptom | First move |
|---|---|
| First request hangs 30–60s | Render cold start. It will answer. Keep talking; do not reload — a reload starts a second cold request. |
| "Authentication required" while signed in, or "We couldn't finish signing you in" | The session cookie did not reach the API. Check the API log line `no session resolved`: if it carries an `origin:` header, the browser is calling the API directly instead of through the proxy (only browsers send `Origin`; a server-side rewrite does not) — that is `NEXT_PUBLIC_API_URL`. If there is no `origin:` and it still 401s, the cookie was set for the wrong domain — that is the auth `baseURL`, see step 4. Do not change cookie attributes live; that has caused an outage before, when a `Partitioned` cookie keyed to the API's site and became invisible to the web origin. |
| Console returns 403 to the operator | Their role never provisioned — check `PARTNER_OPERATOR_EMAILS` spelling and that `bun run grant` ran. Sign out and back in; provisioning is lazy and self-healing. |
| Agent chat produces nothing | `runAgent` has one path to text and no fallback; the response cache is per-process and cold after a deploy. Move to another screen. **Known gap, not a fixable-on-stage issue.** |
| A screen shows a number that looks wrong | It came from the API. `bun test apps/web` enforces that no component carries a hardcoded figure. |
| "This screen didn't load" | The route's error boundary caught a render failure — most likely a payload whose shape drifted because the web app deployed ahead of the API. Press **Try again**; if it repeats, move on and redeploy the API. Nothing was written. |
| The tour is in the way | Press Escape, or click outside it. It remembers being dismissed per surface per browser. |

## What is deliberately not covered

- **Automated end-to-end smoke against production.** The build sandbox has no
  egress — every outbound host returns 403 at the proxy — so production has never
  been exercised from CI or from an agent. The three flows above are manual for
  that reason, and there is no substitute.
- **Load.** One Render instance, in-memory rate limiter. Fine for a demo, not a
  claim to make about capacity.
- **The API suite running as a non-superuser.** Local dev and CI both connect as
  `postgres`, a superuser with BYPASSRLS, so neither can see a privilege or
  row-policy defect. Four reached production in one evening because of it:
  provisioning writing outside the tenant GUC, seeding doing the same, missing
  grants on Better Auth's tables, and no membership of `ccn_app` so
  `SET LOCAL ROLE` was refused. Running the whole suite as a restricted role was
  tried and is not viable as-is — the tests build their fixtures by inserting
  partners and orders directly, which production never does, and they verify by
  reading tables the policies would hide. Making that gate real means reworking
  every fixture to set up and assert through a separate privileged connection.
  Worth doing; not done. In the meantime `packages/db/test/reference-data.test.ts`
  asserts the `ccn_app` membership directly, which is the specific invariant that
  broke, and the API can be exercised by hand against a restricted role by
  creating one, granting it `ccn_app`, and pointing `DATABASE_URL` at it.

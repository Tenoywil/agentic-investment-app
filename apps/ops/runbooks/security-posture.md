# Security posture — what is enforced, and what is not yet

Current as of Phase 7. This is a status document, not an aspiration: anything
listed as **Gap** is genuinely not enforced today and must not be described as
covered in a compliance conversation.

## Enforced

### Outbound (SSRF, OWASP A10) — `@ccn/security/ssrf`
- **Exact-host allowlist** derived from validated config (`outboundAllowlist`), so
  the allowlist cannot drift from the URLs actually deployed. No suffix matching:
  `ht.getimpala.ai.evil.example` is refused.
- https only; URLs carrying credentials are refused.
- Every **resolved** address is checked against loopback / RFC1918 / link-local
  (including the `169.254.169.254` metadata endpoint) / CGNAT / reserved space,
  so an allowlisted name that resolves inward is still blocked.
- Redirects are followed manually with the full check re-run per hop.
- Applied to the AI gateway (`apps/api/src/routes/agent.ts` and, additively,
  `apps/api/src/routes/gateway.ts`'s three agent passes — same
  `createOutboundGuard(deps.config)` instance, not a second guard to keep in sync).

#### Partner audit-event webhook boundary

Partner webhooks use a separate `createPartnerWebhookGuard` instance. Their destinations never join
the AI, OAuth, or Supabase allowlist, and redirects are refused instead of followed. The institution
console is fail-closed: while `PARTNER_WEBHOOK_ALLOWED_HOSTS` is empty, the URL field, activation
switch, and save action remain disabled and the API composition root does not start the dispatcher.

Approval and enablement procedure:

1. Collect the partner's exact receiving hostname and verify hostname ownership, TLS, receiver
   purpose, and the applicable data-processing terms.
2. Add only that hostname to the comma-separated `PARTNER_WEBHOOK_ALLOWED_HOSTS` environment value
   on the Render API service. Entries are hostnames only—no scheme, path, port, query, fragment,
   wildcard, or suffix rule.
3. Preserve other approved hosts that remain in service, save the setting, and redeploy. The config
   is immutable for the lifetime of the API process.
4. Confirm the Compliance page names the approved host before allowing the operator to configure a
   URL. Store the one-time HMAC signing secret in the partner's secrets manager and send a test event.

Removing a hostname from the environment and redeploying locks it out immediately at both the
configuration route and delivery guard. Never unlock the browser controls without this server-side
allowlist: public-IP validation alone does not close the DNS-rebinding window between resolution and
the outbound socket.

**Residual:** DNS rebinding. Addresses are validated, then `fetch` opens the
socket, so a name answering differently between the two is a TOCTOU window. The
exact-host allowlist is what makes this unreachable in practice — an attacker
cannot introduce a hostname, only reuse a trusted one. Closing it fully needs a
custom dispatcher that connects to the pinned IP.

### Rate limiting (A04/A07) — `@ccn/security/rate-limit`
Token buckets per route class (`RATE_LIMITS`), keyed by user id when
authenticated and by client address otherwise. 429 + `Retry-After` on refusal.
Every Gateway endpoint (`apps/api/src/routes/gateway.ts`) is classed
individually rather than as one route-group default — `agent` for the three
LLM passes, `orders` for mutations, `read` for lookups — using the same
limiter map `app.ts` already builds, not a new one.

**Client address:** a forwarding header is trusted **only** when the deployment
sets `TRUSTED_CLIENT_IP_HEADER` (Render sets `X-Forwarded-For`; see
`apps/api/render.yaml`). Without it we use the socket address. An unvalidated
`X-Forwarded-For` would let anyone mint a fresh bucket per request and silently
disable IP limiting.

**Gap:** the store is in-memory, so budgets are per-instance. Correct for one
machine; **before scaling the API past one instance**, implement the Postgres
`RateLimitStore` (the port is the only thing that changes).

### Field encryption (A02) — `@ccn/security/field-crypto`
AES-256-GCM via Web Crypto, AAD-bound to a `table.column:owner` context so a
ciphertext cannot be relocated to another row or column. Envelopes carry a key id
for rotation.

Deviation from the original plan, deliberately: it specified libsodium sealed
boxes, but a sealed box is *asymmetric* ("anyone encrypts, key holder decrypts").
The same service reads and writes these fields, so authenticated symmetric
encryption is the correct primitive and avoids a WASM dependency. Revisit only if
a write-only producer appears.

**Rotation procedure**
1. Generate a new 32-byte key; set it as `FIELD_ENCRYPTION_KEY`.
2. Move the old one into `FIELD_ENCRYPTION_KEY_PREVIOUS` as `id:material`
   (comma-separated for several). Decryption keeps working throughout.
3. Sweep: read each encrypted column, `needsRotation()` → re-encrypt → write.
4. Once the sweep reports zero, drop the retired key from the env.

### Gateway (investor mandate / opportunity / introduction) — additive, no new gaps
`apps/api/src/routes/gateway.ts` reuses every control above rather than
building parallel ones: RLS via the same `withTenant`/`SET LOCAL app.current_user_id`
seam (`packages/db/migrations/0004_gateway_security.sql` — enabled and forced
on all nine new tables, verified against a real Postgres including
cross-tenant denial, not just typechecked); the immutable `audit_log` via
`auditAppend` on every mandate save, opportunity submission, guardrail
decision, and introduction decision; the SSRF guard and rate-limit classes
above. The one new BigInt→JSON-serialization bug this surface exposed
(`apps/api/src/middleware.ts`'s `bigintSafeJson`) was pre-existing risk in
`orders`/`approvals`/the console's order list too — fixed once, globally,
rather than only for the new routes.

### Logging (A09) — `apps/api/src/logger.ts`
One structured JSON line per request (`requestId`, `method`, `route`, `status`,
`actor`, `durationMs`). Every payload passes through `redact` **at the sink**,
masking credential-shaped values and direct identifiers by key and by shape —
the only version of "no secrets in logs" that survives many call sites.
`x-request-id` is generated per request; an inbound value is never trusted.

### Web response headers — `apps/web/next.config.mjs`
HSTS (2y, preload), `nosniff`, `X-Frame-Options: DENY` + `frame-ancestors 'none'`,
`Referrer-Policy`, a deny-by-default `Permissions-Policy`, COOP, and a CSP with
`base-uri 'none'`, `object-src 'none'`, `form-action 'self'`. Set via Next's own
`headers()` function (moved off `vercel.json` when `apps/web` switched to SSR —
see below), so they apply identically regardless of hosting platform.

## Gaps

### CSP is not nonce-based — `script-src` allows `'unsafe-inline'`
The plan called for a per-request nonce and no `unsafe-inline`. This was
previously unachievable because `apps/web` was a static export with no server or
middleware — that blocker is gone now that `apps/web` runs as real Next.js SSR
(Vercel project Root Directory = `apps/web`), but the nonce itself is not yet
wired: `headers()` in `next.config.mjs` is still a static string, and a
`middleware.ts` generating a per-request nonce and threading it into both the
response header and the page's script tags hasn't been built. Next also emits ~7
inline hydration blocks per page whose content changes every render, making a
hash allowlist impractical — a nonce, not a hash list, is still the right shape
for this once it's built.

What the current policy still buys: attacker-hosted scripts cannot load
(`script-src 'self'`), no `<base>` hijacking, no object/embed, no cross-origin
form exfiltration, no framing, and XHR/WS destinations are constrained.

`style-src` also needs `'unsafe-inline'` — data-driven inline `style=` attributes
plus the inline `<style>` element Radix injects for dialog scroll-lock. Verified
empirically: without it the exec modal's styling breaks. CSS injection is a much
smaller risk class than script execution.

**To close:** add `middleware.ts` that generates a per-request nonce, forwards it
to the response CSP header, and threads it to Next's script tags (`nonce` prop /
`headers()` reading a per-request value isn't directly expressible — this needs
the middleware + `next/headers` pattern). Until then React's escaping and
DOMPurify remain the primary XSS controls, not CSP.

### `connect-src` is provider-scoped, not host-scoped
Currently `'self' https://*.onrender.com https://*.supabase.co`, because the
production API hostname is not yet fixed. Those are shared-tenant providers, so
the wildcard is weaker than it looks for exfiltration.
**Go-live checklist item:** replace both wildcards with the exact API and
Supabase hostnames.

### Not yet started
Sentry wiring, alerting and the status page; Supabase PITR configuration and the
quarterly restore drill; Semgrep/Trivy in CI; k6 load profile; the full WCAG 2.2
AA audit pass; and the compliance deliverables (per-jurisdiction licensing
decision log, partner DPA tracker, incident-response runbook, retention schedule).

## Verifying a change

- `bun test packages/security` — 117 tests covering the SSRF bypass classes
  (suffix lookalikes, userinfo disguise, IPv4-mapped IPv6, octal-ambiguous quads),
  bucket arithmetic under clock skew, AEAD tamper/context/rotation, redaction.
- `bun test apps/api/test/app.test.ts` — request id, structured log line, and
  rate-limit refusal end to end.
- CSP: `bun run --filter @ccn/web build && bun run --filter @ccn/web start`,
  load every route and assert zero `Refused to` console messages **and** that a
  client-only control still responds (hydration proves the policy did not silently
  break React).

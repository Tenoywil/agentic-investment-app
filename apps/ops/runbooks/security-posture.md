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
- Applied to the AI gateway (`apps/api/src/routes/agent.ts`).

**Residual:** DNS rebinding. Addresses are validated, then `fetch` opens the
socket, so a name answering differently between the two is a TOCTOU window. The
exact-host allowlist is what makes this unreachable in practice — an attacker
cannot introduce a hostname, only reuse a trusted one. Closing it fully needs a
custom dispatcher that connects to the pinned IP.

### Rate limiting (A04/A07) — `@ccn/security/rate-limit`
Token buckets per route class (`RATE_LIMITS`), keyed by user id when
authenticated and by client address otherwise. 429 + `Retry-After` on refusal.

**Client address:** a forwarding header is trusted **only** when the deployment
sets `TRUSTED_CLIENT_IP_HEADER` (Fly sets `Fly-Client-IP`). Without it we use the
socket address. An unvalidated `X-Forwarded-For` would let anyone mint a fresh
bucket per request and silently disable IP limiting.

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

### Logging (A09) — `apps/api/src/logger.ts`
One structured JSON line per request (`requestId`, `method`, `route`, `status`,
`actor`, `durationMs`). Every payload passes through `redact` **at the sink**,
masking credential-shaped values and direct identifiers by key and by shape —
the only version of "no secrets in logs" that survives many call sites.
`x-request-id` is generated per request; an inbound value is never trusted.

### Web response headers — `vercel.json`
HSTS (2y, preload), `nosniff`, `X-Frame-Options: DENY` + `frame-ancestors 'none'`,
`Referrer-Policy`, a deny-by-default `Permissions-Policy`, COOP, and a CSP with
`base-uri 'none'`, `object-src 'none'`, `form-action 'self'`.

## Gaps

### CSP is not nonce-based — `script-src` allows `'unsafe-inline'`
The plan called for a per-request nonce and no `unsafe-inline`. **That is not
achievable on the current build:** `apps/web` is a static export
(`output: 'export'`) with no server or middleware, so there is no per-request
anything. Next also emits ~7 inline hydration blocks per page whose content
changes every build, making a hash allowlist impractical to maintain in a static
`vercel.json`.

What the current policy still buys: attacker-hosted scripts cannot load
(`script-src 'self'`), no `<base>` hijacking, no object/embed, no cross-origin
form exfiltration, no framing, and XHR/WS destinations are constrained.

`style-src` also needs `'unsafe-inline'` — data-driven inline `style=` attributes
plus the inline `<style>` element Radix injects for dialog scroll-lock. Verified
empirically: without it the exec modal's styling breaks. CSS injection is a much
smaller risk class than script execution.

**To close:** move `apps/web` to SSR (drop `output: 'export'`, point the Vercel
project root at `apps/web`) and set a nonce in middleware. Until then React's
escaping and DOMPurify remain the primary XSS controls, not CSP.

### `connect-src` is provider-scoped, not host-scoped
Currently `'self' https://*.fly.dev https://*.supabase.co`, because the
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
- CSP: serve `apps/web/out`, apply the `vercel.json` policy to HTML responses,
  load every route and assert zero `Refused to` console messages **and** that a
  client-only control still responds (hydration proves the policy did not silently
  break React).

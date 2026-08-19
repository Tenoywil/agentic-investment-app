# Caribbean Capital Network

Caribbean Capital Network (CCN) is a multi-tenant investment platform for Caribbean investors and
regulated financial institutions. It combines a conversational investment agent, suitability and
limits controls, human approvals, portfolio aggregation, partner order workflows, compliance
review, and an immutable audit trail.

The repository is a Bun monorepo. The live product is not the legacy root-level static prototype.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js investor, institution, compliance, and administration surfaces |
| `apps/api` | Hono API, authentication, tenant boundaries, agent orchestration, webhooks, and realtime events |
| `packages/db` | Drizzle schema, Postgres migrations, RLS policies, security-definer functions, and reference data |
| `packages/agent` | Agent tools, prompts, display contracts, evaluations, and model gateway |
| `packages/security` | SSRF controls, field encryption, redaction, rate limiting, and IP validation |
| `packages/domain` | Shared schemas and domain contracts |
| `design/agents` | Architecture, orchestration, approval, integration, and KYC diagrams |
| `apps/ops/runbooks` | Deployment, migration, incident, and security operating procedures |

## Local development

Requirements:

- Bun 1.3 or newer (`.bun-version` is authoritative for CI)
- Node.js 24 or newer
- PostgreSQL 16 with pgvector for database-backed integration tests

Copy `.env.example` to `.env.local`, replace every placeholder, then install dependencies:

```bash
bun install
```

Apply migrations before starting an environment that writes data:

```bash
cd packages/db
bun run db:migrate
```

Run the API and web application from their workspace directories:

```bash
cd apps/api && bun run dev
cd apps/web && bun run dev
```

## Partner audit-event webhooks

Webhook configuration is deliberately **locked by default**. When
`PARTNER_WEBHOOK_ALLOWED_HOSTS` is empty, the institution console disables the destination field,
activation switch, and save action, and the API does not start the dispatcher. This is a security
boundary, not a feature flag the browser may override.

To enable a partner destination:

1. Obtain the exact HTTPS receiving hostname from the partner, for example
   `events.partner.example`. Do not include a scheme, path, port, query string, or wildcard.
2. Complete the integration/security review: confirm the partner owns the hostname, TLS is valid,
   the receiver expects CCN audit events, and the data-processing agreement covers the export.
3. Add the exact hostname to the API service's comma-separated
   `PARTNER_WEBHOOK_ALLOWED_HOSTS` value in Render. Keep previously approved hosts that must remain
   active.
4. Redeploy the API. The allowlist is loaded once at process start; changing the dashboard value
   without a redeploy does not unlock the console.
5. Sign in as the partner operator, open **Compliance → Audit-event webhook**, configure the full
   HTTPS URL, save the one-time signing secret in a secrets manager, and send a test event.

Example:

```text
PARTNER_WEBHOOK_ALLOWED_HOSTS=events.partner.example,hooks.second-partner.example
```

The API still resolves every approved hostname and refuses loopback, private, link-local, metadata,
CGNAT, reserved, non-HTTPS, credential-bearing, custom-port, query-string, fragment, and redirect
destinations. Never use `*`, a suffix wildcard, or a shared catch-all webhook host to make the field
available. See the [security posture](apps/ops/runbooks/security-posture.md) for the enforced egress
controls.

## Verification

Before merging a change:

```bash
bunx biome lint .
bun run typecheck
bun run test
```

Database-dependent tests run when `DATABASE_URL` points to a migrated test database. The pre-commit
hook also runs Gitleaks; do not bypass it.

## Deployment and operations

- [Database migrations](apps/ops/runbooks/database-migrations.md)
- [Security posture](apps/ops/runbooks/security-posture.md)
- [Demo-day readiness](apps/ops/runbooks/demo-day.md)
- [Agent system design](design/agents/README.md)

Render's free plan does not run pre-deploy migrations. Any merge containing a migration requires the
manual procedure in the database runbook before the affected feature is used.

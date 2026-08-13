# Bun + Hono API, deployed on Render (see apps/api/render.yaml). Build from the
# REPO ROOT (monorepo context) — Render's dockerContext is set to "." for this.
FROM oven/bun:1.3.11 AS base
WORKDIR /app

# Install workspace dependencies against the committed lockfile.
COPY . .
RUN bun install --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 3001

# Secrets (DATABASE_URL, BETTER_AUTH_SECRET, GOOGLE_*, OPENAI_*, …) are injected
# at runtime via the Render dashboard's env vars — never baked into the image.
CMD ["bun", "run", "apps/api/src/index.ts"]

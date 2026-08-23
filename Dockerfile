# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/docs/package.json ./apps/docs/
COPY apps/docs/source.config.ts ./apps/docs/
# fumadocs-mdx postinstall needs the content dir to exist
RUN mkdir -p apps/docs/content/docs
COPY packages/database/package.json ./packages/database/
COPY packages/ai/package.json ./packages/ai/
COPY packages/rag/package.json ./packages/rag/
COPY packages/evals/package.json ./packages/evals/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/widget-core/package.json ./packages/widget-core/
COPY packages/widget/package.json ./packages/widget/
COPY packages/react/package.json ./packages/react/
COPY examples/react-widget/package.json ./examples/react-widget/
COPY examples/node-sdk-chat/package.json ./examples/node-sdk-chat/
COPY examples/nextjs-portfolio/package.json ./examples/nextjs-portfolio/
RUN pnpm install --frozen-lockfile

FROM base AS builder
# pnpm puts bins/deps in per-package node_modules; copy the whole deps tree
COPY --from=deps /app ./
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ARG DATABASE_URL=postgresql://chatai:chatai@db:5432/chatai
ARG BETTER_AUTH_SECRET=build-time-secret-at-least-32-characters-long
ARG BETTER_AUTH_URL=http://localhost:3000
ENV DATABASE_URL=$DATABASE_URL
ENV BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
ENV BETTER_AUTH_URL=$BETTER_AUTH_URL

RUN pnpm --filter @chatai/web build

# Portable migrate runtime (flat node_modules; migrator is not in Next standalone trace)
FROM node:22-alpine AS migrate-deps
WORKDIR /migrate
RUN npm install --omit=dev drizzle-orm@0.40.1 postgres@3.4.5

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV UPLOAD_DIR=/app/uploads

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs \
  && mkdir -p /app/uploads \
  && chown nextjs:nodejs /app/uploads \
  && apk add --no-cache wget

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/packages/database/migrations ./packages/database/migrations
COPY --from=builder /app/packages/database/scripts/migrate.mjs ./packages/database/scripts/migrate.mjs
COPY --from=migrate-deps /migrate/node_modules ./packages/database/node_modules
# Seed resolves `postgres` from packages/database/node_modules (ESM walks up from script path)
COPY scripts/seed-demo.mjs ./packages/database/scripts/seed-demo.mjs
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]

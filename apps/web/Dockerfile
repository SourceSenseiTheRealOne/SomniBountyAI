# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN cd apps/web && npm ci

FROM base AS builder
ARG NEXT_PUBLIC_SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network/
ARG NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS=
ARG NEXT_PUBLIC_VULNERABILITY_REGISTRY_ADDRESS=
ENV NEXT_PUBLIC_SOMNIA_RPC_URL=$NEXT_PUBLIC_SOMNIA_RPC_URL
ENV NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS=$NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS
ENV NEXT_PUBLIC_VULNERABILITY_REGISTRY_ADDRESS=$NEXT_PUBLIC_VULNERABILITY_REGISTRY_ADDRESS
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY apps/web ./apps/web
RUN cd apps/web && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone /app
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static /app/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public /app/public

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "server.js"]

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/ai-core/package.json ./packages/ai-core/
COPY apps/sync-server/package.json ./apps/sync-server/
RUN pnpm install --frozen-lockfile --filter @boardmind/ai-core --filter @boardmind/sync-server
COPY packages/ai-core/ ./packages/ai-core/
COPY apps/sync-server/ ./apps/sync-server/
RUN pnpm --filter @boardmind/ai-core build
RUN pnpm --filter @boardmind/sync-server build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 4000
CMD ["node", "apps/sync-server/dist/index.js"]

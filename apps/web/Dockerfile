FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app

FROM base AS builder
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/ai-core/package.json ./packages/ai-core/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @boardmind/ai-core --filter @boardmind/web
COPY packages/ai-core/ ./packages/ai-core/
COPY apps/web/ ./apps/web/
RUN pnpm --filter @boardmind/ai-core build
RUN pnpm --filter @boardmind/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@boardmind/web", "start"]

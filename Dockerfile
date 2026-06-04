FROM node:20-alpine AS base

# Install dependencies for production
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build the application
FROM base AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=deps    /app/node_modules       ./node_modules
COPY --from=builder /app/.next              ./.next
COPY --from=builder /app/public             ./public
COPY --from=builder /app/package.json       ./
COPY --from=builder /app/prisma             ./prisma
COPY --from=builder /app/prisma.config.ts   ./
COPY --from=builder /app/next.config.ts     ./
COPY --from=builder /app/src/generated      ./src/generated
# tsx needed for seed script at runtime
COPY --from=builder /app/node_modules/.bin/tsx            ./node_modules/.bin/tsx
COPY --from=builder /app/node_modules/tsx                 ./node_modules/tsx

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

# migrate on startup; seed is run manually once via: docker exec finance-tracker npm run db:seed
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]

# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
# prisma.config.ts insists on DATABASE_URL even though `generate` never connects.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
    && npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/package.json ./package.json
USER node
EXPOSE 3000
# Apply pending migrations, then start. `migrate deploy` never resets data.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]

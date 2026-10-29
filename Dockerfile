FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm i  --omit=dev --no-audit --no-fund; \
    fi

COPY src ./src

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

# Команду задаёт docker-compose (bot/worker)
CMD ["node", "-e", "console.log('Set command in docker-compose.yml')"]

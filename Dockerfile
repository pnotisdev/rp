# Runs the whole app from one Node process: the Express API and the built client on one port.
# See DOCKER.md for usage. Model backends (KoboldCpp etc.) still run wherever you already run them —
# the browser talks to those directly, so this image never needs to reach them.

# --- build the client -------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
# Must bind all interfaces to be reachable through Docker's published port; see server/index.ts.
ENV API_HOST=0.0.0.0
ENV API_PORT=3001
WORKDIR /app

RUN chown node:node /app
USER node

# Production deps only — no vite/tsx/typescript. Node 24 runs the server's .ts files directly via
# built-in type stripping, so there's no server build step and nothing to transpile at runtime.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Server source, committed seed assets, and the client build from the stage above.
COPY --chown=node:node server ./server
COPY --chown=node:node seed ./seed
COPY --from=build --chown=node:node /app/dist ./dist

# All characters/chats/worlds/images live under data/ — mount a volume here to keep them.
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3001
CMD ["node", "--experimental-sqlite", "server/index.ts"]

# God's Eye View — production image
# Serves the Vite build via `vite preview` so all /api/* proxies stay in-process.
FROM node:24-bookworm-slim

WORKDIR /app

# Install dependencies first for better layer caching.
# Vite lives in devDependencies but is required to serve preview + API proxies.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Bake client-exposed keys at build time (Google Maps / Cesium ion).
# Server-only secrets (OpenAI, AISStream, FIRMS, TomTom, …) are injected at runtime.
ARG GOOGLE_MAPS_API_KEY=
ARG CESIUM_ION_TOKEN=
ENV GOOGLE_MAPS_API_KEY=$GOOGLE_MAPS_API_KEY \
    CESIUM_ION_TOKEN=$CESIUM_ION_TOKEN \
    OPENSKY_AUTH_MODE=anon \
    HOST=0.0.0.0 \
    PORT=4173

RUN npm run build

ENV NODE_ENV=production

EXPOSE 4173

# Preview keeps the same middleware surface as `vite` (see ensurePreviewApiProxies).
CMD ["npm", "run", "start"]

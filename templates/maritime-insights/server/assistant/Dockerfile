# syntax=docker/dockerfile:1
#
# ⚠️ Build context is the REPO ROOT, not this folder — the image needs `public/terrain/*/tracks.*`
# so the assistant's tools read the same asset the browser downloads. Build with:
#   az acr build --registry <acr> --image maritime-assistant:vN --file server/assistant/Dockerfile .
#
# The `.dockerignore` at the root excludes everything and re-includes level by level, so the
# context stays a few hundred kB instead of shipping terrain rasters and node_modules.

FROM node:24-alpine AS deps
WORKDIR /app
COPY server/assistant/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8081
ENV TERRAIN_DIR=/app/terrain
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server/assistant/package.json server/assistant/server.mjs server/assistant/config.mjs ./
COPY server/assistant/lib ./lib

# Only the two files the tools actually read. Copying the whole terrain folder would drag in
# ~90 MB of rasters the assistant never opens.
COPY public/terrain/kieler-foerde/tracks.json public/terrain/kieler-foerde/tracks.binz \
     public/terrain/kieler-foerde/heightmap_4m.json public/terrain/kieler-foerde/los_16m.json \
     ./terrain/kieler-foerde/
COPY public/terrain/schlei/tracks.json public/terrain/schlei/tracks.binz \
     public/terrain/schlei/heightmap_4m.json public/terrain/schlei/los_16m.json \
     ./terrain/schlei/

EXPOSE 8081
CMD ["node", "server.mjs"]

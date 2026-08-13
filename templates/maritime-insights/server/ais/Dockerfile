# AIS relay — the piece that cannot live in static hosting.
#
# Two reasons this exists as a container rather than a function:
#   * the upstream feed forbids browser connections, so something server-side has to hold the key;
#   * that something has to hold a WebSocket open, which a request-scoped function cannot.
#
# Node 24 ships a WebSocket client, so there are no dependencies to install and no lockfile to
# keep honest — the image is the runtime plus four source files and a 0.2 MB asset.
FROM node:24-alpine

WORKDIR /app

# The relay itself. Zero dependencies, so no npm install step at all.
COPY server/ais/ ./server/ais/
# The relay derives its upstream subscription bbox from the AOI config, so the
# config travels with it. Without this the process exits on the first line.
COPY config/aoi/ ./config/aoi/

# The recorded day, so `--replay` works with no key and no network. 0.2 MB, and it is what makes
# the live path demonstrable before anyone has signed up for anything.
COPY public/terrain/kieler-foerde/tracks.binz public/terrain/kieler-foerde/tracks.json \
     ./public/terrain/kieler-foerde/

# Container Apps injects PORT; the relay reads it. Documented, not assumed.
ENV PORT=8788
EXPOSE 8788

# Run unprivileged. The base image already ships a `node` user.
USER node

CMD ["node", "server/ais/relay.js"]

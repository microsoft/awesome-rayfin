# The OGN relay, as a container — PLAN §5.3.
#
# The published app is STATIC hosting: it cannot open a TCP socket to APRS-IS, so Mode C on the
# deployed site has always fallen back to the recording. This image is the missing half — the one
# piece of this project that genuinely needs a long-lived process, because APRS-IS is a persistent
# TCP connection and the browser is fed by Server-Sent Events. Neither survives a request/response
# function.
#
# Deliberately tiny: the relay has ZERO npm dependencies (node builtins only), so there is no
# install step, no lockfile to honour and nothing to audit. What it needs is `server/` and the
# `config/` beside it, because the relay derives its APRS filter from the same area definitions the
# renderer uses rather than restating them.
FROM node:22-alpine

WORKDIR /app

# Only what the relay reads. Copying the whole repo would drag in ~70 MB of generated terrain that
# this process never opens.
COPY server/ ./server/
COPY config/ ./config/

# Container Apps sets PORT; the relay reads it. ORIGIN restricts CORS to the published app.
ENV PORT=8080
ENV OGN_WORLD=allgaeu

EXPOSE 8080

# Run as a non-root user. There is nothing secret in the image, but the process talks to the open
# internet on two sides and there is no reason for it to be root while doing so.
USER node

CMD ["node", "server/ogn/relay.js"]

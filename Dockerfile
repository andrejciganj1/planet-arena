# The server runs the same sim as the browser, so it needs the shared code next to it.
FROM node:22-alpine
WORKDIR /app
COPY src/tuning.js src/tuning.js
COPY src/sim src/sim
COPY src/net src/net
COPY server server
RUN cd server && npm ci --omit=dev
ENV PORT=8080
CMD ["node", "server/server.js"]

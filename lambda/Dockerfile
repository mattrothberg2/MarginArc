# Multi-stage: build web, install server, serve both
FROM node:20-alpine AS builder
WORKDIR /app

# Web build
COPY web/package*.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

# Server install
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY server ./server

# Copy built SPA into server/public
RUN mkdir -p server/public && cp -r web/dist/* server/public/

# Runtime
FROM node:20-alpine
WORKDIR /app/server
ENV NODE_ENV=production
COPY --from=builder /app/server .
EXPOSE 8080
CMD ["node", "index.js"]

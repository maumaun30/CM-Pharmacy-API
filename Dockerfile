# Multi-stage build for the Express API.
# Stage 1 installs production dependencies only; stage 2 is a lean runtime image.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy resolved production node_modules, then the app source.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Run as the built-in non-root `node` user.
USER node

EXPOSE 5000

# server.js verifies the Postgres connection on boot (DATABASE_URL injected by ECS).
CMD ["node", "server.js"]

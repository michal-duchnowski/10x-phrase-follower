# syntax=docker/dockerfile:1.7
# Multi-stage build for production
FROM node:22.14.0-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application with an ephemeral BuildKit secret. The `.env` file is never
# copied into the image or persisted in an ARG/ENV layer.
RUN --mount=type=secret,id=build_env \
    tr -d '\r' < /run/secrets/build_env > /tmp/build.env && \
    set -a && . /tmp/build.env && set +a && rm -f /tmp/build.env && npm run build

# Production stage
FROM node:22.14.0-alpine AS runner

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built application from builder (includes assets copied by build script)
COPY --from=builder /app/dist ./dist

# Expose port 3000
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist/server/entry.mjs"]


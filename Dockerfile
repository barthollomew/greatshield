# Multi-stage build for Greatshield Discord Moderation Bot
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ sqlite-dev

# Copy package files
COPY package*.json ./
COPY bot/package*.json ./bot/
COPY website/package*.json ./website/

# Install dependencies
RUN npm ci --only=production && \
    cd bot && npm ci --only=production && \
    cd ../website && npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build && \
    cd website && npm run build

# Production stage
FROM node:20-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S greatshield && \
    adduser -S greatshield -u 1001

# Install runtime dependencies
RUN apk add --no-cache \
    sqlite \
    curl \
    tini \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=greatshield:greatshield /app/dist ./dist/
COPY --from=builder --chown=greatshield:greatshield /app/node_modules ./node_modules/
COPY --from=builder --chown=greatshield:greatshield /app/bot/schemas ./bot/schemas/
COPY --from=builder --chown=greatshield:greatshield /app/bot/templates ./bot/templates/
COPY --from=builder --chown=greatshield:greatshield /app/website/dist ./website/dist/
COPY --from=builder --chown=greatshield:greatshield /app/package.json ./

# Create directories for data persistence
RUN mkdir -p /app/data /app/logs /app/config /app/backups && \
    chown -R greatshield:greatshield /app

# Switch to non-root user
USER greatshield

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose ports
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV DB_PATH=/app/data/greatshield.db
ENV CONFIG_PATH=/app/config
ENV BACKUP_PATH=/app/backups

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "dist/src/index.js"]

# Labels for metadata
LABEL org.opencontainers.image.title="Greatshield Discord Moderation Bot"
LABEL org.opencontainers.image.description="AI-powered Discord moderation bot with local-first architecture"
LABEL org.opencontainers.image.vendor="Greatshield Team"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/greatshield/greatshield-bot"
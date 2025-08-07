# Multi-stage build for optimized production image
FROM node:18-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S discordbot -u 1001

WORKDIR /app

# Copy built dependencies from builder stage
COPY --from=builder --chown=discordbot:nodejs /app/node_modules ./node_modules

# Copy application files
COPY --chown=discordbot:nodejs . .

# Create logs directory
RUN mkdir -p logs && chown discordbot:nodejs logs

# Set environment variables for performance
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512 --gc-interval=100"
ENV UV_THREADPOOL_SIZE=4

# Switch to non-root user
USER discordbot

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('Bot is running')" || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
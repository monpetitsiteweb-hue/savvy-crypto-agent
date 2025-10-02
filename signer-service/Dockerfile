FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source
COPY index.js ./

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/healthz', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Run as non-root
USER node

EXPOSE 3000

CMD ["node", "index.js"]

# --- Builder stage ---
FROM node:25-bookworm-slim AS builder

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

# Only install deps first for better caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source
COPY . .

# Set safe defaults for public envs used at build time
ARG NEXT_PUBLIC_SURREAL_URL=ws://127.0.0.1:8000/rpc
ARG NEXT_PUBLIC_SURREAL_NS=mlops
ARG NEXT_PUBLIC_SURREAL_DB=cloud_ui
ARG NEXT_PUBLIC_SURREAL_USER=root
ARG NEXT_PUBLIC_SURREAL_PASS=root

ENV NEXT_PUBLIC_SURREAL_URL=$NEXT_PUBLIC_SURREAL_URL \
    NEXT_PUBLIC_SURREAL_NS=$NEXT_PUBLIC_SURREAL_NS \
    NEXT_PUBLIC_SURREAL_DB=$NEXT_PUBLIC_SURREAL_DB \
    NEXT_PUBLIC_SURREAL_USER=$NEXT_PUBLIC_SURREAL_USER \
    NEXT_PUBLIC_SURREAL_PASS=$NEXT_PUBLIC_SURREAL_PASS

# Build the Next.js app
RUN npm run build


# --- Runner stage ---
FROM node:25-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    \
    # Server-side SurrealDB connection (override at runtime)
    SURREAL_URL=ws://surreal:8000/rpc \
    SURREAL_NS=mlops \
    SURREAL_DB=cloud_ui \
    SURREAL_USER=root \
    SURREAL_PASS=root \
    \
    # Server-side MinIO/S3 connection (override at runtime)
    MINIO_ENDPOINT_INTERNAL=http://minio:9000 \
    MINIO_REGION=us-east-1 \
    MINIO_ACCESS_KEY_ID=minioadmin \
    MINIO_SECRET_ACCESS_KEY=minioadmin \
    MINIO_BUCKET=mlops-datasets \
    MINIO_FORCE_PATH_STYLE=true \
    \
    # Use PutObject for files below this size (in bytes); higher uses multipart
    S3_MULTIPART_THRESHOLD_BYTES=1000000000

WORKDIR /app

# Copy only required runtime assets
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

# Health hint (optional)
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT, r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]

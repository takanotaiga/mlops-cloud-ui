# MLOps Cloud UI

Modern Next.js + TypeScript + Chakra UI app for managing datasets, launching training, and shipping models.

## Tech Stack
- Next.js App Router (TypeScript, strict mode)
- Chakra UI (primitive components, color mode via next-themes)
- Yarn (Node 18+)

## Scripts
- `yarn dev`: Run local dev server with HMR
- `yarn build`: Generate production build (offline font usage)
- `yarn start`: Serve the production build
- `yarn type-check`: TypeScript type check (no emit)

## Project Structure
- `app/`: Routes, layouts, and pages
  - `/dataset`: Listing, details, and upload
  - `/training`: Model training dashboard
- `components/`: Reusable UI components
- `components/ui/color-mode.tsx`: Color mode provider and toggle button
- `public/static/`: Static assets served from `/static/*`

## Development Notes
- Use Yarn for all local development and CI.
- Path alias: import with `@/*` as needed.
- Chakra styling stays co-located with components.
- Color mode toggle is available in the header; it uses `next-themes` under the hood.

## Environment & Security
- Put secrets in `.env.local` (git-ignored). Access via `process.env`.
- Avoid importing large assets into client bundles; put assets in `public/static`.

## Accessibility
- Prefer semantic markup and Chakra components.
- Verify color-mode contrast via the header toggle.

## Contributing
- Conventional Commits (e.g., `feat:`, `fix:`) are preferred.
- Keep PRs small and focused; include screenshots for UI changes.

To enable TypeScript's features, we install the type declarations for React and
Node.

```
npm install --save-dev @types/react @types/react-dom @types/node
```

When we run `next dev` the next time, Next.js will start looking for any `.ts`
or `.tsx` files in our project and builds it. It even automatically creates a
`tsconfig.json` file for our project with the recommended settings.

Next.js has built-in TypeScript declarations, so we'll get autocompletion for
Next.js' modules straight away.

A `type-check` script is also added to `package.json`, which runs TypeScript's
`tsc` CLI in `noEmit` mode to run type-checking separately. You can then include
this, for example, in your `test` scripts.

## Docker

- Build local image:
  - `docker build -t ghcr.io/<OWNER>/<REPO>:dev .`
- Run locally:
  - `docker run --rm -p 3000:3000 \
    -e NEXT_PUBLIC_SURREAL_URL=ws://127.0.0.1:8000/rpc \
    -e NEXT_PUBLIC_SURREAL_NS=mlops \
    -e NEXT_PUBLIC_SURREAL_DB=cloud_ui \
    -e NEXT_PUBLIC_SURREAL_USER=root \
    -e NEXT_PUBLIC_SURREAL_PASS=root \
    ghcr.io/takanotaiga/mlops-cloud-ui:main`
- Open: http://localhost:3000

Notes:
- Replace `<OWNER>/<REPO>` with your GitHub org/repo.
- Set `NEXT_PUBLIC_*` as needed for your environment; values above are local examples.

## Backend Environment Variables (Server)

The UI now proxies SurrealDB and S3/MinIO through Next.js API routes (no direct browser credentials). Configure server-side envs via `docker run -e` or your orchestrator:

- SurrealDB
  - `SURREAL_URL`: e.g., `ws://surreal:8000/rpc` (must include `/rpc`)
  - `SURREAL_NS`, `SURREAL_DB`
  - `SURREAL_USER`, `SURREAL_PASS`

- MinIO / S3
  - `MINIO_ENDPOINT_INTERNAL`: server-visible endpoint (e.g., `http://minio:9000`)
  - `MINIO_REGION`: default `us-east-1`
  - `MINIO_ACCESS_KEY_ID`, `MINIO_SECRET_ACCESS_KEY`
  - `MINIO_BUCKET`: e.g., `mlops-datasets`
  - `MINIO_FORCE_PATH_STYLE`: default `true`
  - `S3_MULTIPART_THRESHOLD_BYTES` (optional): default `1000000000` (1GB). Files below use PutObject; above use multipart.

Example:

```
docker run --rm -p 3000:3000 \
  -e NEXT_PUBLIC_SURREAL_URL=ws://127.0.0.1:8000/rpc \
  -e NEXT_PUBLIC_SURREAL_NS=mlops \
  -e NEXT_PUBLIC_SURREAL_DB=cloud_ui \
  -e NEXT_PUBLIC_SURREAL_USER=root \
  -e NEXT_PUBLIC_SURREAL_PASS=root \
  -e SURREAL_URL=ws://surreal:8000/rpc \
  -e SURREAL_NS=mlops \
  -e SURREAL_DB=cloud_ui \
  -e SURREAL_USER=root \
  -e SURREAL_PASS=root \
  -e MINIO_ENDPOINT_INTERNAL=http://minio:9000 \
  -e MINIO_REGION=us-east-1 \
  -e MINIO_ACCESS_KEY_ID=minioadmin \
  -e MINIO_SECRET_ACCESS_KEY=minioadmin \
  -e MINIO_BUCKET=mlops-datasets \
  -e MINIO_FORCE_PATH_STYLE=true \
  -e S3_MULTIPART_THRESHOLD_BYTES=1000000000 \
  ghcr.io/takanotaiga/mlops-cloud-ui:main
```

In Compose, prefer service names for `SURREAL_URL`/`MINIO_ENDPOINT_INTERNAL` (e.g., `ws://surreal:8000/rpc`, `http://minio:9000`). Do not bake real keys into the image.

## Docker Compose

An example Compose file is provided at `docker-compose.example.yml` that starts the UI, SurrealDB, and MinIO together.

Quick start:

```
cp docker-compose.example.yml docker-compose.yml
docker compose up -d --build
```


Services:
- `surreal`: WebSocket RPC at `ws://localhost:8000/rpc` (inside Compose: `ws://surreal:8000/rpc`)
- `minio`: S3-compatible at `http://localhost:9000` (console at `http://localhost:9001`); healthcheck waits for readiness
- `app`: UI at `http://localhost:3000`

The UI calls Surreal/S3 via server-side API routes. Ensure the server envs in the Compose file reflect your desired bucket and credentials. For large uploads, tune `S3_MULTIPART_THRESHOLD_BYTES`.

If you see `S3: Error (minio not found)` in the UI:
- Ensure Compose is running all services: `docker compose ps`
- Verify app can resolve the service name: services are on the same Compose network; `MINIO_ENDPOINT_INTERNAL` must be `http://minio:9000` (not localhost)
- MinIO may still be starting; the provided healthcheck should gate the app start, but a browser refresh after 5–10s can help
- Check logs: `docker compose logs minio -f` and `docker compose logs app -f`

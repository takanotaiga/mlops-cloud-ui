# Repository Guidelines

## Project Structure & Module Organization
- app/: Next.js App Router pages and layouts (e.g., app/page.tsx, app/layout.tsx). Route groups live under app/*.
- components/: Reusable UI and feature components (e.g., header.tsx, image-card.tsx, ui/color-mode.tsx).
- public/static/: Static assets served at /static/*.
- next.config.js, tsconfig.json: Build and TypeScript settings; note path alias '@/*'.

## Build, Test, and Development Commands
- Use Yarn for all local development and build verification (CI also uses Yarn). Node 18+.
- yarn dev: Run the local dev server with HMR.
- yarn build: Create a production build via Next.js.
- yarn start: Serve the production build.
- yarn type-check: Run TypeScript type checking (no emit).
- Build verification flow: yarn install && yarn build && yarn start (do not use npm for verification).

## Coding Style & Naming Conventions
- TypeScript: Strict mode enabled; ESNext modules and bundler resolution.
- Components: PascalCase component names; prefer functional components.
- Files: kebab-case for filenames (e.g., content-card.tsx). Pages follow Next.js conventions (page.tsx, layout.tsx, not-found.tsx).
- Imports: Use '@/*' alias for app-local modules when helpful.
- UI: Use Chakra UI primitives where possible; keep styling co-located with components.

## Testing Guidelines
- No test runner is configured yet. If adding tests, prefer Jest or Vitest + React Testing Library.
- Naming: *.test.ts(x) next to source or in __tests__/.
- Aim for meaningful unit tests of components and route handlers; add basic accessibility assertions.

## Commit & Pull Request Guidelines
- Commits: Use Conventional Commits where possible (e.g., feat:, fix:, refactor:). Keep messages imperative and scoped.
- PRs: Provide a clear description, screenshots for UI changes, and steps to validate. Link related issues and note any breaking changes.
- Size: Favor small, focused PRs with passing type checks.

## Security & Configuration Tips
- Secrets: Store env vars in .env.local (git-ignored). Reference via process.env and Next.js runtime config as needed.
- Assets: Place user-visible assets in public/static. Avoid importing large files into client bundles.
- Accessibility: Use semantic markup and Chakra’s a11y-friendly components; verify color mode via components/ui/color-mode.tsx.

## Backend Architecture

- MinIO: S3-compatible object storage used for binary data (images/videos). Accessed directly from the browser via AWS SDK v3 `S3Client` using an S3 endpoint, access key/secret, and bucket.
- SurrealDB: Graph/SQL database used for metadata (files, datasets). Accessed from the browser via the `surrealdb` JS client through a `SurrealProvider` React context.
- Secrets Module: Default development credentials and endpoints live in `app/secrets/*` for convenience. Real secrets must be provided via environment variables in `.env.local`.

### Key Files
- `app/secrets/minio-config.tsx`: Exposes `MINIO_CONFIG` (endpoint, region, accessKeyId, secretAccessKey, bucket, `forcePathStyle`). Used by upload UI and connection checks.
- `app/secrets/surreal-config.ts`: Exposes `SURREAL_CONFIG` (URL, ns, db, username, password). Consumed by `app/provider.tsx` to initialize the DB client.
- `components/surreal/SurrealProvider.tsx`: Wraps the app with a Surreal client; handles connect, signin, and `USE NS/DB` selection.
- `components/status/connection-status.tsx`: Lightweight health indicator for SurrealDB and MinIO (HeadBucket check).
- `app/dataset/upload/page.tsx`: Client-side multipart upload to MinIO, then metadata registration in SurrealDB.

### Environment Variables
- Prefer setting client-usable values via `NEXT_PUBLIC_*` in `.env.local` so they are available in the browser:
  - `NEXT_PUBLIC_SURREAL_URL` (e.g., `ws://127.0.0.1:8000/rpc`)
  - `NEXT_PUBLIC_SURREAL_NS`, `NEXT_PUBLIC_SURREAL_DB`
  - `NEXT_PUBLIC_SURREAL_USER`, `NEXT_PUBLIC_SURREAL_PASS`
- `MINIO_CONFIG` currently reads static values from `app/secrets/minio-config.tsx`. For production, move these to environment variables and avoid shipping credentials to the client.

### Connectivity Notes
- SurrealDB URL: The Surreal JS client supports WebSocket (recommended for browser) in the form `ws://host:port/rpc`. Ensure the path includes `/rpc` when using WebSocket/HTTP as required by your server.
- MinIO: The AWS SDK v3 is configured with `forcePathStyle: true` for MinIO compatibility. Ensure CORS and bucket policy allow browser-based PUT/Multipart uploads from your app’s origin.

### Data Flow
- Upload: User selects files → client uploads to MinIO (`S3MultipartUpload`) → upon success, the app writes metadata to SurrealDB with fields: `name`, `key`, `bucket`, `size`, `mime`, `dataset`, `encode`, `uploadedAt`.
- Dataset Listing: Query SurrealDB for datasets grouped by name, e.g. `SELECT dataset FROM file GROUP BY dataset;`, then render dynamic dataset tiles using the existing thumbnail UI.

### Security Considerations
- Do not commit real access keys or DB passwords. The values in `app/secrets/*` are placeholders for local development only.
- Direct-from-browser S3/MinIO uploads require exposing credentials or using presigned URLs. For production, prefer a server/API that issues short-lived presigned URLs or uses an identity provider.
- Validate and sanitize any user-provided dataset names when writing to the DB or constructing object keys.

### Local Setup (example)
- MinIO: Start a local MinIO server, create a bucket (e.g., `horus-bucket`), and set CORS to allow your dev origin. Update `endpoint`, `accessKeyId`, `secretAccessKey`, and `bucket` in `app/secrets/minio-config.tsx` or via env.
- SurrealDB: Start SurrealDB with WebSocket enabled. Set `NEXT_PUBLIC_SURREAL_URL` to `ws://localhost:8000/rpc`, and configure `NEXT_PUBLIC_SURREAL_NS`, `NEXT_PUBLIC_SURREAL_DB`, `NEXT_PUBLIC_SURREAL_USER`, `NEXT_PUBLIC_SURREAL_PASS`.
- Dev Flow: `yarn dev` starts the UI. The header’s connection badge reflects SurrealDB and MinIO reachability.

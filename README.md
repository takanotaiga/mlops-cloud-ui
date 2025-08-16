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

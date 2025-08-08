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

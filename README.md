# MLOps Cloud UI

MLOps Cloud の Next.js UI です。Dataset、Inference、Training、Terminal、Hardware、Docs、Settings 画面と、SurrealDB / MinIO を扱う Next.js API routes を提供します。

## Stack

- Next.js 16 App Router
- React 19
- TypeScript strict
- Chakra UI v3
- React Query
- hls.js
- DuckDB WASM for parquet preview
- npm / `package-lock.json`

## Commands

```bash
npm ci
npm run dev
npm run type-check
npm run lint
npm run build
npm run start
```

局所変更では対象ファイル lint も有効です。

```bash
npx eslint app/inference/opened-job/client.tsx
```

## Runtime Architecture

UI は browser-only app ではありません。SurrealDB / MinIO 操作は Next.js API routes を通します。

- Browser: UI 操作、React Query、Chakra UI
- API routes: DB/S3 proxy, status, upload, HLS playlist rewriting
- SurrealDB: file, dataset, inference_job, inference_result, hls_* records
- MinIO/S3: uploaded files, generated videos, HLS playlist/segments, parquet/json artifacts

Backend worker とは直接通信せず、DB record と S3 object を介して非同期に連携します。

## Environment Variables

Client-visible Surreal settings:

```bash
NEXT_PUBLIC_SURREAL_URL=ws://database:8000/rpc
NEXT_PUBLIC_SURREAL_NS=mlops
NEXT_PUBLIC_SURREAL_DB=cloud_ui
NEXT_PUBLIC_SURREAL_USER=root
NEXT_PUBLIC_SURREAL_PASS=root
```

Server-side settings used by API routes:

```bash
SURREAL_URL=ws://database:8000/rpc
SURREAL_NS=mlops
SURREAL_DB=cloud_ui
SURREAL_USER=root
SURREAL_PASS=root
MINIO_ENDPOINT_INTERNAL=http://object-storage:9000
MINIO_REGION=us-east-1
MINIO_ACCESS_KEY_ID=minioadmin
MINIO_SECRET_ACCESS_KEY=minioadmin
MINIO_BUCKET=mlops-datasets
MINIO_FORCE_PATH_STYLE=true
S3_MULTIPART_THRESHOLD_BYTES=1000000000
```

Do not bake real secrets into images. In compose, use service names instead of localhost.

## Docker

```bash
docker build -t mlops-cloud-ui:dev .
docker run --rm -p 3000:3000 \
  -e SURREAL_URL=ws://database:8000/rpc \
  -e SURREAL_NS=mlops \
  -e SURREAL_DB=cloud_ui \
  -e SURREAL_USER=root \
  -e SURREAL_PASS=root \
  -e MINIO_ENDPOINT_INTERNAL=http://object-storage:9000 \
  -e MINIO_REGION=us-east-1 \
  -e MINIO_ACCESS_KEY_ID=minioadmin \
  -e MINIO_SECRET_ACCESS_KEY=minioadmin \
  -e MINIO_BUCKET=mlops-datasets \
  -e MINIO_FORCE_PATH_STYLE=true \
  mlops-cloud-ui:dev
```

Usually prefer the integrated compose in `../mlops-cloud`.

```bash
cd ../mlops-cloud
docker compose -f docker-compose.dev.yml up --build
```

## Important Routes

| Route | Purpose |
|---|---|
| `/api/status` | SurrealDB / MinIO health |
| `/api/db/query` | allowlisted DB operation proxy |
| `/api/storage/upload` | server-side upload |
| `/api/storage/object` | server-side object proxy with range support |
| `/api/storage/hls/playlist` | HLS playlist proxy that rewrites segment URLs |
| `/dataset` | dataset listing |
| `/dataset/upload` | upload flow |
| `/inference` | inference job listing |
| `/inference/create` | inference job creation |
| `/inference/opened-job` | inference job detail, progress, artifact browser |
| `/inference/opened-job/analysis` | parquet analysis |

## Inference UI Notes

- Inference result videos are expected to be HLS encoded by backend `video_manager.py` / `cv-backend`.
- The artifact browser opens videos, JSON, parquet and other files in a full-screen dialog.
- HLS playback in dialogs must attach after the `<video>` element is mounted. Preserve the ref/state pattern in `app/inference/opened-job/client.tsx`.
- Long artifact keys must be ellipsized and contained with `minW={0}` to avoid horizontal overflow.

## Validation

For normal UI work:

```bash
npm run type-check
npx eslint <changed-file>
npm run build
```

For UI + DB/S3 flows:

```bash
cd ../mlops-cloud
docker compose -f e2e/compose.phase1.yml up --build --abort-on-container-exit --exit-code-from e2e e2e
docker compose -f e2e/compose.phase1.yml down -v
```

Current Phase1 expected result is `6 passed, 3 skipped`.

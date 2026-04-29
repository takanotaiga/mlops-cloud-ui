# AGENTS.md

このリポジトリは MLOps Cloud の Next.js UI です。作業前にこのファイルと、必要に応じてワークスペース直下の `ARCHITECTURE.md` / `E2E_TEST_RUNBOOK.md` を確認してください。

## 役割

- Next.js App Router による UI と API routes を提供します。
- ブラウザから SurrealDB / MinIO へ直接接続する設計には戻さないでください。
- DB/S3 へのアクセスは Next.js API routes とサーバー側 env を通します。
- Backend worker とは直接 HTTP API で会話せず、SurrealDB レコードと S3 object を共有境界にします。

## 技術スタック

- Next.js 16 App Router
- React 19
- Chakra UI v3
- React Query
- TypeScript strict
- npm / `package-lock.json`

Yarn 前提の記述やコマンドを増やさないでください。

## 主要ディレクトリ

| パス | 内容 |
|---|---|
| `app/` | App Router pages, route handlers, page-local clients |
| `components/` | 共通 UI / provider / Surreal helper |
| `lib/server/` | route handler から使うサーバー側 DB/S3 helper |
| `public/` | 静的アセット |

## よく使うコマンド

```bash
npm ci
npm run dev
npm run type-check
npx eslint app/inference/opened-job/client.tsx
npm run lint
npm run build
```

`npm run lint` はリポジトリ全体の既存設定問題に当たる場合があります。局所変更では対象ファイル lint も併用してください。

## 環境変数

ブラウザ向け接続表示や provider 用:

- `NEXT_PUBLIC_SURREAL_URL`
- `NEXT_PUBLIC_SURREAL_NS`
- `NEXT_PUBLIC_SURREAL_DB`
- `NEXT_PUBLIC_SURREAL_USER`
- `NEXT_PUBLIC_SURREAL_PASS`

サーバー側 API routes 用:

- `SURREAL_URL`
- `SURREAL_NS`
- `SURREAL_DB`
- `SURREAL_USER`
- `SURREAL_PASS`
- `MINIO_ENDPOINT_INTERNAL`
- `MINIO_REGION`
- `MINIO_ACCESS_KEY_ID`
- `MINIO_SECRET_ACCESS_KEY`
- `MINIO_BUCKET`
- `MINIO_FORCE_PATH_STYLE`
- `S3_MULTIPART_THRESHOLD_BYTES`

Compose 内では `localhost` ではなく service name を使います。例: `ws://database:8000/rpc`, `http://object-storage:9000`。

## DB Query Proxy

`/api/db/query` は任意 SQL プロキシとして扱わないでください。現在は allowlist operation と入力検証を前提にします。

新規 UI から DB 操作を増やす場合は次を優先してください。

1. 専用 route handler を追加する。
2. どうしても汎用 proxy を使う場合は operation allowlist と schema validation を追加する。
3. ブラウザから raw SQL を渡す実装は追加しない。

## 推論画面の注意

- `app/inference/opened-job/client.tsx` は job detail, progress, artifact browser を持つ大きめの client component です。
- 推論完了後の成果物動画は HLS 化済みとして扱います。mp4 key でも再生経路は `hls_playlist` と `/api/storage/hls/playlist` です。
- Dialog 内で動画を表示する場合、`video` 要素が mount された後に hls.js を attach する必要があります。`ref.current` の一回読みだけに戻さないでください。
- 成果物ブラウザでは長い S3 key が横幅を押し広げやすいです。Flex item には `minW={0}` と text ellipsis を意識してください。
- Dialog の close button は `Dialog.CloseTrigger` が絶対配置になることがあります。アクションボタンと重なる場合は通常の `CloseButton` + state close を使います。

## 推論ジョブ作成

- `inferenceBackend` は `tensorrt-fp16`, `pytorch-fp16`, `pytorch-fp32` を扱います。
- 互換性のためデフォルトは `tensorrt-fp16` です。
- `rtdetrEpochs` は UI から可変、既定値は 4 です。
- 現状の実行 worker は `taskType=one-shot-object-detection`, `model=samurai-ulr`, 単一 dataset / 単一 video を前提にします。

## E2E

UI 変更では `mlops-cloud` リポジトリから Phase1 を実行するのが基本です。

```bash
cd ../mlops-cloud
docker compose -f e2e/compose.phase1.yml up --build --abort-on-container-exit --exit-code-from e2e e2e
docker compose -f e2e/compose.phase1.yml down -v
```

2026-04-29 時点の Phase1 は `6 passed, 3 skipped` が期待値です。skip は未確定仕様の `test.fixme` です。

画面構造や route handler に触れた場合は `npm run build` も実行してください。

## Git / PR

- main へ直接コミットしないでください。
- 作業ブランチは `codex/<description>` を基本にします。
- 変更範囲が UI だけなら、このリポジトリでブランチ・commit・push・PR を完結させます。
- PR には validation と E2E 結果を明記してください。

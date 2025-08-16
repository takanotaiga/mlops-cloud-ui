"use client";

import { Box, Heading, Text, VStack, HStack, Badge, Code, Link as ChakraLink } from "@chakra-ui/react";
import NextLink from "next/link";

const Line = () => <Box h="1px" bg="gray.200" />;

export default function DocsDeveloperPage() {
  return (
    <HStack justify="center">
      <VStack w={{ base: "92%", md: "75%" }} maxW="1000px" align="stretch" py="28px" gap="18px">
        <HStack gap="3" align="center">
          <Heading size="2xl">デベロッパー向けガイド</Heading>
          <Badge rounded="full" variant="subtle" colorPalette="purple">Developer</Badge>
        </HStack>
        <Text color="gray.700">開発者・運用者向けに、環境構築、バックエンド構成（MinIO / SurrealDB）、データフロー、セキュリティ、トラブルシューティングをまとめています。</Text>

        <Box>
          <Heading size="lg" mb="3">クイックスタート（開発環境）</Heading>
          <Box as="ol" pl="5" style={{ listStyle: "decimal" }}>
            <Box as="li">Node 18+ と Yarn を用意。</Box>
            <Box as="li">SurrealDB を起動（推奨：WebSocket）。例：<Code>ws://localhost:8000/rpc</Code></Box>
            <Box as="li">MinIO（または S3 互換）を起動し、バケットを作成（例：<Code>mlops-datasets</Code>）。CORS とポリシーを適切に設定。</Box>
            <Box as="li">フロントの環境変数（<Code>.env.local</Code>）を設定：
              <Box mt="1" pl="3">
                <Code display="block" whiteSpace="pre" p="2">{`NEXT_PUBLIC_SURREAL_URL=ws://localhost:8000/rpc
NEXT_PUBLIC_SURREAL_NS=mlops
NEXT_PUBLIC_SURREAL_DB=cloud_ui
NEXT_PUBLIC_SURREAL_USER=root
NEXT_PUBLIC_SURREAL_PASS=root`}</Code>
              </Box>
            </Box>
            <Box as="li">開発サーバ：<Code>yarn dev</Code> ／ 本番ビルド：<Code>yarn build && yarn start</Code></Box>
          </Box>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">バックエンド構成</Heading>
          <Box as="ul" pl="5" style={{ listStyle: "disc" }}>
            <Box as="li"><b>MinIO / S3</b>：ブラウザから AWS SDK v3 で直接アップロード。互換性のため <Code>forcePathStyle: true</Code> を使用。</Box>
            <Box as="li"><b>SurrealDB</b>：WebSocket/HTTP RPC（<Code>.../rpc</Code>）で接続し、<Code>connect</Code> → <Code>signin</Code> → <Code>USE NS/DB</Code> を実行。</Box>
          </Box>
          <Text mt="2">開発用のデフォルト値は <Code>app/secrets/*</Code> にありますが、本番は <Code>.env.local</Code> の <Code>NEXT_PUBLIC_*</Code> で上書きしてください。</Text>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">設定ファイル</Heading>
          <Box as="ul" pl="5" style={{ listStyle: "disc" }}>
            <Box as="li"><Code>app/secrets/minio-config.tsx</Code>：<Code>endpoint</Code>, <Code>region</Code>, <Code>accessKeyId</Code>, <Code>secretAccessKey</Code>, <Code>bucket</Code>, <Code>forcePathStyle</Code></Box>
            <Box as="li"><Code>app/secrets/surreal-config.ts</Code>：<Code>NEXT_PUBLIC_SURREAL_URL</Code>, <Code>NEXT_PUBLIC_SURREAL_NS</Code>, <Code>NEXT_PUBLIC_SURREAL_DB</Code>, <Code>NEXT_PUBLIC_SURREAL_USER</Code>, <Code>NEXT_PUBLIC_SURREAL_PASS</Code></Box>
          </Box>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">データフロー</Heading>
          <Box as="ul" pl="5" style={{ listStyle: "disc" }}>
            <Box as="li"><b>アップロード</b>：ブラウザ → MinIO（multipart）。成功後に SurrealDB の <Code>file</Code> テーブルへメタデータを保存。</Box>
            <Box as="li"><b>データセット表示</b>：<Code>SELECT dataset FROM file GROUP BY dataset;</Code> で一覧取得。</Box>
            <Box as="li"><b>推論</b>：<Code>inference_job</Code> を作成・更新。実行エンジンは別プロセスで連携。</Box>
            <Box as="li"><b>トレーニング</b>：<Code>training_job</Code> を upsert／更新／削除。状態（<Code>ProcessWaiting</Code> / <Code>StopInterrept</Code> など）に応じて UI が切替。</Box>
          </Box>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">推論結果（Parquet）</Heading>
          <Text mb="2">推論結果は列指向の <b>Parquet</b> 形式で保存・返却されます。高速なスキャンと圧縮により、大規模な結果でも効率的に扱えます（スキーマはジョブ/モデルに依存）。</Text>
          <Box as="ul" pl="5" style={{ listStyle: "disc" }} mb="3">
            <Box as="li">保存先：MinIO / S3 バケット配下のジョブ固有プレフィックス（例：<Code>.../inference/&lt;job_name&gt;/part-*.parquet</Code>）。</Box>
            <Box as="li">スキーマ確認：<Code>pyarrow</Code> のメタデータまたは <Code>dataset</Code> API で列名・型を確認できます。</Box>
          </Box>

          <Heading size="md" mb="2">Python で読む（S3/MinIO 直読み）</Heading>
          <Text color="gray.700" mb="2">最小構成は <Code>pandas</Code> + <Code>pyarrow</Code> + <Code>s3fs</Code>。MinIO の場合は <Code>endpoint_url</Code> と認証情報を指定します。</Text>
          <Code display="block" whiteSpace="pre" p="2" mb="3">{`# pip install pandas pyarrow s3fs
import pandas as pd

# S3/MinIO の URL と認証情報
parquet_uri = "s3://YOUR_BUCKET/inference/<job_name>/"  # 単一ファイルでも可: .../result.parquet
storage_opts = {
    "key": "minio-access-key",
    "secret": "minio-secret-key",
    "client_kwargs": {"endpoint_url": "http://127.0.0.1:9000"},  # MinIO のエンドポイント
}

# 読み込み（ディレクトリ指定で複数パートを結合）
df = pd.read_parquet(parquet_uri, storage_options=storage_opts)
print(df.head())
print(df.columns)
`}</Code>

          <Heading size="md" mb="2">クエリ例（pandas）</Heading>
          <Code display="block" whiteSpace="pre" p="2" mb="3">{`# 例: 信頼度 0.5 以上だけに絞り込み（列名はスキーマに合わせて変更）
filtered = df[df["score"] >= 0.5]

# 例: ラベルごとの件数
by_label = filtered.groupby("label").size().reset_index(name="count")
print(by_label.sort_values("count", ascending=False).head())

# 例: 必要な列だけ選択
subset = filtered[["id", "label", "score"]]
`}</Code>

          <Heading size="md" mb="2">スキーマの確認（pyarrow.dataset）</Heading>
          <Code display="block" whiteSpace="pre" p="2" mb="3">{`# pip install pyarrow s3fs
import pyarrow.dataset as ds

dataset = ds.dataset(
    "s3://YOUR_BUCKET/inference/<job_name>/",
    format="parquet",
    filesystem=ds.filesystem("s3", **{
        "access_key": "minio-access-key",
        "secret_key": "minio-secret-key",
        "endpoint_override": "http://127.0.0.1:9000",
    }),
)
print(dataset.schema)  # 列名・型を確認

# 例: Arrow 式でフィルタして読み出し
table = dataset.to_table(filter=ds.field("score") >= 0.5)
print(table.num_rows)
`}</Code>

          <Heading size="md" mb="2">ローカルファイルから読む</Heading>
          <Code display="block" whiteSpace="pre" p="2">{`import pandas as pd
df = pd.read_parquet("./result.parquet")
print(df.head())
`}</Code>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">セキュリティ</Heading>
          <Box as="ul" pl="5" style={{ listStyle: "disc" }}>
            <Box as="li">本番でブラウザ直アップロードを行う場合、長期キーは埋め込まず、署名付きURLまたは短期クレデンシャルを発行する中継 API を推奨。</Box>
            <Box as="li">リポジトリに本番キーをコミットしない（<Code>app/secrets/*</Code> は開発用）。</Box>
            <Box as="li">CORS・バケットポリシーは最小権限で構成。</Box>
            <Box as="li">ユーザー入力（データセット名など）はサニタイズする。</Box>
          </Box>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">トラブルシューティング</Heading>
          <Box as="ul" pl="5" style={{ listStyle: "disc" }}>
            <Box as="li">接続バッジが赤：MinIO/SurrealDB の起動、URL に <Code>/rpc</Code>、CORS 設定を確認。</Box>
            <Box as="li">アップロード失敗：バケットの存在、<Code>forcePathStyle</Code>、アクセスキー、ポリシー（PUT/Multipart 許可）を確認。</Box>
            <Box as="li">一覧に出ない：<Code>file</Code> にレコードが作成されているか確認。</Box>
            <Box as="li">推論/学習が進まない：バックエンドワーカー／実行エンジンとの連携を確認。</Box>
          </Box>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">参考リンク</Heading>
          <Box as="ul" pl="5" style={{ listStyle: "disc" }}>
            <Box as="li"><ChakraLink as={NextLink} href="/dataset/upload" color="teal.600">アップロード画面</ChakraLink></Box>
            <Box as="li"><ChakraLink as={NextLink} href="/dataset" color="teal.600">データセット一覧</ChakraLink></Box>
            <Box as="li"><ChakraLink as={NextLink} href="/inference" color="teal.600">推論一覧</ChakraLink></Box>
            <Box as="li"><ChakraLink as={NextLink} href="/settings" color="teal.600">設定</ChakraLink></Box>
          </Box>
        </Box>

        <Line />

        <Text color="gray.600">ユーザー向けガイドは <ChakraLink as={NextLink} href="/docs/user" color="teal.600">/docs/user</ChakraLink> を参照してください。モデルの「One shot」「SAMURAI ULR」などの用語解説はユーザー向け側にプレースホルダーを用意しています。</Text>
      </VStack>
    </HStack>
  );
}

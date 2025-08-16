"use client";

import { Box, Heading, Text, VStack, HStack, Badge, Code, Link as ChakraLink } from "@chakra-ui/react";
import NextLink from "next/link";

const Line = () => <Box h="1px" bg="gray.200" />;

export default function DocsUserPage() {
  return (
    <HStack justify="center">
      <VStack w={{ base: "92%", md: "75%" }} maxW="900px" align="stretch" py="28px" gap="18px">
        <HStack gap="3" align="center">
          <Heading size="2xl">ユーザー向けガイド</Heading>
          <Badge rounded="full" variant="subtle" colorPalette="green">User</Badge>
        </HStack>
        <Text color="gray.700">バックエンドの知識は不要です。このガイドでは、MLOps Cloud の基本的な使い方（データセットのアップロード、一覧・詳細の見方、推論とトレーニングの始め方、設定ページ）を順に説明します。</Text>

        <Box>
          <Heading size="lg" mb="3">はじめに</Heading>
          <Text>画面上部のヘッダーから <ChakraLink as={NextLink} href="/dataset" color="teal.600">データセット</ChakraLink>、<ChakraLink as={NextLink} href="/inference" color="teal.600">推論</ChakraLink>、<ChakraLink as={NextLink} href="/docs" color="teal.600">ドキュメント</ChakraLink>、<ChakraLink as={NextLink} href="/settings" color="teal.600">設定</ChakraLink> に移動できます。中央の小さなバッジは接続状況の目安です。</Text>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">データセットのアップロード</Heading>
          <Box as="ol" pl="5" style={{ listStyle: "decimal" }}>
            <Box as="li">アップロード画面に移動：<ChakraLink as={NextLink} href="/dataset/upload" color="teal.600">/dataset/upload</ChakraLink></Box>
            <Box as="li">「Dataset Name」に任意の名前を入力します（例：<Code>roadscenes-2025-08</Code>）。</Box>
            <Box as="li">「ファイルを選択」から画像・動画ファイルを選びます（複数可）。</Box>
            <Box as="li">動画を含む場合のエンコードモード：複数種類の動画や単一の動画は<b>Do Nothing</b>、連番動画（例：frame_0001.mp4, frame_0002.mp4 ... のように分割されている場合）は<b>All Merge</b>を選択してください。</Box>
            <Box as="li">「Upload to cloud」を押すとアップロードが始まります。完了後に次の操作へ進めます。</Box>
          </Box>
          <Text mt="2">アップロードが終わったら、<ChakraLink as={NextLink} href="/dataset" color="teal.600">データセット一覧</ChakraLink>で反映を確認できます。</Text>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">データセットの探索</Heading>
          <Box as="ul" pl="5" style={{ listStyle: "disc" }}>
            <Box as="li">一覧では検索欄で名前を絞り込めます。</Box>
            <Box as="li">カードをクリックすると詳細ページへ移動し、タイトルやサムネイルを確認できます。</Box>
          </Box>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">推論（インフェレンス）の使い方</Heading>
          <Box as="ol" pl="5" style={{ listStyle: "decimal" }}>
            <Box as="li">推論一覧：<ChakraLink as={NextLink} href="/inference" color="teal.600">/inference</ChakraLink> で既存のジョブを確認できます。</Box>
            <Box as="li">新規作成：「新規推論」をクリックし、ジョブ名・タスク・モデル・使用するデータセットを選びます。</Box>
            <Box as="li">作成後：ジョブ詳細画面で状態や更新時刻を確認できます。詳細から「分析」ビューを開くと、出力された Parquet の統計を可視化できます。</Box>
          </Box>
          <Box mt="3">
            <Heading size="md" mb="2">分析ビューでできること（グラフ）</Heading>
            <Box as="ul" pl="5" style={{ listStyle: "disc" }}>
              <Box as="li"><b>Line（折れ線）</b>：数値列を時間・フレーム番号などの軸で可視化。移動平均ウィンドウで平滑化、Y軸の自動/0始まり、対数スケール切替に対応。</Box>
              <Box as="li"><b>Derivative（変化量）</b>：折れ線の一階差分（フレーム間の増減）を表示。変化の急激な箇所を発見。</Box>
              <Box as="li"><b>Frequency（頻度）</b>：カテゴリ列の出現回数トップNを棒グラフで表示（割合表示も可）。</Box>
              <Box as="li"><b>Histogram（ヒストグラム）</b>：数値列の分布をビン数を指定して表示（割合表示も可）。</Box>
              <Box as="li"><b>CDF / CCDF</b>：累積分布・右側累積分布。しきい値超過率の把握に有効。</Box>
              <Box as="li"><b>Scatter（散布図）</b>：2列の関係を点で表示。対数スケールやトレンドライン（最小二乗直線）に対応。</Box>
              <Box as="li"><b>Correlation（相関ヒートマップ）</b>：選択した複数列の相関係数行列を色で可視化。</Box>
              <Box as="li"><b>Cumulative Sum（累積和）</b>：選択列を累積足し上げ。総量の推移を把握。</Box>
              <Box as="li"><b>% Change（パーセント変化）</b>：前の値比／先頭比での増減率を表示。</Box>
              <Box as="li"><b>Missing Profile（欠損プロファイル）</b>：各列の欠損率（空/Nan/無限大を含む）を一覧化。</Box>
            </Box>
            <Text mt="2" color="gray.700">操作ポイント：X軸の列選択と範囲フィルタ、Y列の複数選択、頻度・ヒストグラムのパラメータ（Top N／Bins）、対数スケールのオン/オフを切り替えて分析できます。</Text>
          </Box>
          <Text mt="3">注：分析ビューはジョブの出力（Parquet）を読み込みます。環境によっては表示まで数秒かかることがあります。</Text>
        </Box>

        <Line />

        

        <Line />

        <Box>
          <Heading size="lg" mb="3">設定ページ</Heading>
          <Text>ヘッダー右端のメニュー（≡）から <ChakraLink as={NextLink} href="/settings" color="teal.600">/settings</ChakraLink> に移動できます。表示や基本的な挙動に関する設定をまとめています。</Text>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">用語メモ</Heading>
          <Box as="ul" pl="5" style={{ listStyle: "disc" }}>
            <Box as="li"><b>One-shot（ワンショット）学習</b>：たった1つ（またはごく少数）の例から学習・汎化させる考え方です。大規模に事前学習済みのモデルを土台に「これが正解」という見本を1つ与え、似たパターンを見分けられるようにします。大量のアノテーションが難しい場面で便利ですが、見本と全く異なるケースでは性能が落ちやすい点に注意してください。</Box>
            <Box as="li"><b>SAM2</b>：Segment Anything の第2世代。画像の中から「ここ！」と指示した点・枠の周辺を素早く正確に切り出すための仕組み（セグメンテーション）。いろいろな画像に強く、物体の輪郭取りが得意です。</Box>
            <Box as="li"><b>RT‑DETR</b>：リアルタイム版 DETR（Transformer 系の物体検出器）。画像や動画の各フレームに対して、物体の種類（ラベル）と位置（四角い枠）を高速に出力します。</Box>
            <Box as="li"><b>SAMURAI ULR</b>：上の <b>SAM2</b>（賢い切り出し）で得た知識を、<b>RT‑DETR</b>（高速な検出器）に「教え込む」（知識蒸留）ことで生まれた派生モデルです。超長尺（Ultra Long Range）な動画でも、遠くて小さい物やフレームをまたいだ変化を捉えやすい設計になっています。一方で、数秒の短い動画では前提が合わずパフォーマンスが低くなる場合があります。</Box>
          </Box>
        </Box>

        <Line />

        <Box>
          <Heading size="lg" mb="3">よくある質問</Heading>
          <Box as="ul" pl="5" style={{ listStyle: "disc" }}>
            <Box as="li"><b>アップロードしたのに一覧に出ません</b>：少し時間を置いて再読み込みしてください。改善しない場合は管理者にご相談ください。</Box>
            <Box as="li"><b>どのモデルを選べばいいですか？</b>：最初はデフォルトの推奨モデルから試し、目的に合わせて変更してください。</Box>
          </Box>
        </Box>

        <Line />

        <Text color="gray.600">困ったときはこのドキュメントを検索するか、管理者・開発チームにお問い合わせください。</Text>
      </VStack>
    </HStack>
  );
}

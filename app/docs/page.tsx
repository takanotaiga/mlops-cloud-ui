"use client";

import { Box, Heading, Text, VStack, HStack, Badge, Link as ChakraLink } from "@chakra-ui/react";
import NextLink from "next/link";

export default function DocsIndexPage() {
  return (
    <HStack justify="center">
      <VStack w={{ base: "92%", md: "75%" }} maxW="1000px" align="stretch" py="28px" gap="18px">
        <HStack gap="3" align="center">
          <Heading size="2xl">ドキュメント</Heading>
          <Badge rounded="full" variant="subtle" colorPalette="purple">Guide</Badge>
        </HStack>
        <Text color="gray.700">さぁ、はじめよう！🎉 あなたにぴったりのガイドを選んでね。</Text>

        <HStack align="stretch" gap="18px" flexWrap="wrap">
          <Box
            role="group"
            flex="1 1 320px"
            minW="280px"
            rounded="md"
            borderWidth="1px"
            borderColor="yellow.200"
            bgGradient="linear(to-br, white, yellow.50)"
            p="16px"
            transition="all .2s ease-in-out"
            _hover={{ boxShadow: "md", transform: "translateY(-2px)" }}
          >
            <Heading size="lg" mb="2">ユーザー向け 😄</Heading>
            <Badge mb="2" rounded="full" variant="subtle" colorPalette="pink">おすすめ</Badge>
            <Text color="gray.700" mb="3">わかりやすく楽しく学べる入門ガイド。アップロード・閲覧・推論・トレーニング・設定までサクッと体験しよう！✨</Text>
            <ChakraLink as={NextLink} href="/docs/user" color="teal.600" fontWeight="semibold">ワクワクしながら進む →</ChakraLink>
          </Box>
          <Box
            role="group"
            flex="1 1 320px"
            minW="280px"
            rounded="md"
            borderWidth="1px"
            borderColor="blue.200"
            bgGradient="linear(to-br, white, blue.50)"
            p="16px"
            transition="all .2s ease-in-out"
            _hover={{ boxShadow: "md", transform: "translateY(-2px)" }}
          >
            <Heading size="lg" mb="2">デベロッパー向け 🛠️</Heading>
            <Badge mb="2" rounded="full" variant="subtle" colorPalette="blue">技術者向け</Badge>
            <Text color="gray.700" mb="3">環境構築から MinIO / SurrealDB、データフローやセキュリティまで、実装のコツをぎゅっと凝縮！🚀</Text>
            <ChakraLink as={NextLink} href="/docs/developer" color="teal.600" fontWeight="semibold">さぁ、はじめる →</ChakraLink>
          </Box>
        </HStack>
      </VStack>
    </HStack>
  );
}

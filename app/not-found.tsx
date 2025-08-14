"use client";

import { Box, Center, Heading, Text, Button, HStack, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import Link from "next/link";

const float = keyframes({
  "0%": { transform: "translateY(0px)" },
  "50%": { transform: "translateY(-14px)" },
  "100%": { transform: "translateY(0px)" },
});

const sway = keyframes({
  "0%": { transform: "translateX(0px) rotate(0deg)" },
  "50%": { transform: "translateX(10px) rotate(6deg)" },
  "100%": { transform: "translateX(0px) rotate(0deg)" },
});

export default function Page() {
  return (
    <Box position="relative" overflow="hidden">
      {/* Decorative floating blobs */}
      <Box
        position="absolute"
        top="-40"
        left="-40"
        w="72"
        h="72"
        rounded="full"
        filter="blur(40px)"
        opacity={0.5}
        bgGradient="linear(to-br, pink.300, purple.400)"
        animation={`${float} 7s ease-in-out infinite`}
        pointerEvents="none"
      />
      <Box
        position="absolute"
        bottom="-32"
        right="-32"
        w="64"
        h="64"
        rounded="full"
        filter="blur(42px)"
        opacity={0.45}
        bgGradient="linear(to-tr, cyan.300, teal.400)"
        animation={`${sway} 9s ease-in-out infinite`}
        pointerEvents="none"
      />

      <Center minH="70vh" py={{ base: 16, md: 24 }} px={4}>
        <VStack gap={6} textAlign="center">
          <Heading
            size={{ base: "4xl", md: "6xl" }}
            bgGradient="linear(to-r, pink.500, purple.500, cyan.400)"
            bgClip="text"
            lineHeight="1"
          >
            404
          </Heading>
          <Text fontSize={{ base: "md", md: "lg" }} color="gray.600">
            404なんて誰も見たくないけど… 見ちゃったなら、
            ちょっとワクワクしていこう！いえーい✌️
          </Text>
          <Text fontSize={{ base: "sm", md: "md" }} color="gray.500">
            ページが迷子になりました。リンクが変わったか、移動したのかもしれません。
          </Text>
          <HStack gap={4} pt={2}>
            <Link href="/">
              <Button colorPalette="purple" variant="solid">ホームへ戻る</Button>
            </Link>
            <Link href="/dataset">
              <Button variant="subtle" colorPalette="cyan">データセットを見る</Button>
            </Link>
          </HStack>
        </VStack>
      </Center>
    </Box>
  );
}

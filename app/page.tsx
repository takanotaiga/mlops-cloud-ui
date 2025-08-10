"use client"
import { Box, VStack, HStack, Heading, Text, Button, SimpleGrid, Badge } from "@chakra-ui/react"
import NextLink from "next/link"
import { useI18n } from "@/components/i18n/LanguageProvider"

export default function Page() {
  const { t } = useI18n()
  return (
    <Box position="relative" overflow="hidden">
      <Box
        position="absolute"
        inset="0"
        bgGradient="radial( at 20% 10%, teal.200, transparent 40% ), radial( at 80% 20%, cyan.200, transparent 45% ), radial( at 50% 100%, purple.200, transparent 50% )"
        opacity={0.45}
        pointerEvents="none"
      />

      <VStack w="100%" pt="18vh" pb="8vh" px="6" position="relative">
        <VStack w={{ base: "100%", md: "70%" }} textAlign="center" gap="5">
          <Badge size="md" rounded="full" colorPalette="teal" variant="subtle">{t('home.introducing','Introducing')}</Badge>
          <Heading size="4xl" lineHeight="1.1">{t('home.title','MLOps Cloud ✨')}</Heading>
          <Text color="gray.600" fontSize={{ base: "md", md: "lg" }}>{t('home.subtitle')}</Text>
          <HStack gap="3" pt="2">
            <NextLink href="/dataset" passHref>
              <Button rounded="full" size="md">{t('cta.get_started','Get Started 🎉')}</Button>
            </NextLink>
            <NextLink href="/training" passHref>
              <Button variant="outline" rounded="full" size="md">{t('cta.view_training','View Training 🚀')}</Button>
            </NextLink>
            <NextLink href="/inference/playground" passHref>
              <Button variant="outline" rounded="full" size="md">{t('cta.try_playground','Try Playground ⚡')}</Button>
            </NextLink>
          </HStack>
        </VStack>
      </VStack>

      <VStack w="100%" pb="14vh" px="6" position="relative">
        <SimpleGrid w={{ base: "100%", md: "70%" }} columns={{ base: 1, md: 2, lg: 4 }} gap="6">
          <Box p="6" rounded="lg" borderWidth="1px" bg="bg.panel">
            <Heading size="md" mb="2">{t('features.dataset.title','Dataset Management 📚')}</Heading>
            <Text color="gray.600">{t('features.dataset.desc')}</Text>
          </Box>
          <Box p="6" rounded="lg" borderWidth="1px" bg="bg.panel">
            <Heading size="md" mb="2">{t('features.training.title','Automated Training 🚀')}</Heading>
            <Text color="gray.600">{t('features.training.desc')}</Text>
          </Box>
          <Box p="6" rounded="lg" borderWidth="1px" bg="bg.panel">
            <Heading size="md" mb="2">{t('features.registry.title','Model Registry 🏷️')}</Heading>
            <Text color="gray.600">{t('features.registry.desc')}</Text>
          </Box>
          <Box p="6" rounded="lg" borderWidth="1px" bg="bg.panel">
            <Heading size="md" mb="2">{t('features.observability.title','Observability 📈')}</Heading>
            <Text color="gray.600">{t('features.observability.desc')}</Text>
          </Box>
        </SimpleGrid>
      </VStack>
    </Box>
  )
}

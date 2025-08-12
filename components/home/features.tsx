"use client"

import { Box, VStack, SimpleGrid, Heading, Text } from "@chakra-ui/react"
import { useI18n } from "@/components/i18n/LanguageProvider"

export function HomeFeatures() {
  const { t } = useI18n()
  return (
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
  )
}


"use client";

import { Box, Heading, HStack, VStack, Text, Badge, Button, ButtonGroup } from "@chakra-ui/react";
import { useI18n } from "@/components/i18n/LanguageProvider";

export default function SettingsPage() {
  const { lang, setLang, t } = useI18n();

  return (
    <HStack justify="center">
      <VStack w={{ base: "95%", md: "70%" }} align="stretch" gap="16px" py="24px">
        <HStack justify="space-between" align="center">
          <HStack gap="3" align="center">
            <Heading size="2xl">{t("settings.title","Settings")}</Heading>
            <Badge rounded="full" variant="subtle" colorPalette="gray">{t("settings.badge","Settings")}</Badge>
          </HStack>
        </HStack>

        <Text textStyle="sm" color="gray.600">{t("settings.subtitle","Configure your preferences")}</Text>

        <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
          <Heading size="md" mb="10px">{t("settings.language.title","Language")}</Heading>
          <Text textStyle="sm" color="gray.600" mb="8px">{t("settings.language.desc","Choose your display language")}</Text>
          <ButtonGroup size="sm" variant="outline">
            <Button variant={lang === "en" ? "solid" : "outline"} onClick={() => setLang("en")}>English</Button>
            <Button variant={lang === "ja" ? "solid" : "outline"} onClick={() => setLang("ja")}>日本語</Button>
          </ButtonGroup>
        </Box>
      </VStack>
    </HStack>
  );
}

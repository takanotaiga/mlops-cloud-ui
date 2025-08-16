"use client";

import { Box, Heading, HStack, VStack, Text, Badge, Button, ButtonGroup, Dialog, Portal, CloseButton } from "@chakra-ui/react";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { useEffect, useState } from "react";
import AppInfoCard from "@/components/meta/AppInfoCard";

async function getOpfsRoot(): Promise<any> {
  const ns: any = (navigator as any).storage;
  if (!ns?.getDirectory) throw new Error("OPFS not supported in this browser");
  return await ns.getDirectory();
}

async function computeDirSizeBytes(dir: any): Promise<number> {
  let total = 0;
   
  for await (const [, handle] of (dir as any).entries()) {
    try {
      if (handle.kind === "file") {
        const f = await handle.getFile();
        total += f.size || 0;
      } else if (handle.kind === "directory") {
        total += await computeDirSizeBytes(handle);
      }
    } catch { /* ignore */ }
  }
  return total;
}

async function clearAllEntries(dir: any): Promise<void> {
  // Collect names first to avoid iterator invalidation
  const names: string[] = [];
   
  for await (const [name] of (dir as any).entries()) names.push(name);
  for (const name of names) {
    try {
      await dir.removeEntry(name, { recursive: true });
    } catch { /* ignore */ }
  }
}

function humanizeBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const fixed = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${fixed} ${units[i]}`;
}

export default function SettingsPage() {
  const { lang, setLang, t } = useI18n();
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [loadingCache, setLoadingCache] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);
  const [cacheError, setCacheError] = useState<string | null>(null);

  async function refreshCacheSize() {
    setLoadingCache(true);
    setCacheError(null);
    try {
      const root = await getOpfsRoot();
      const total = await computeDirSizeBytes(root);
      setCacheBytes(total);
    } catch (e: any) {
      setCacheError(String(e?.message || e));
      setCacheBytes(null);
    } finally {
      setLoadingCache(false);
    }
  }

  useEffect(() => { refreshCacheSize(); }, []);

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

        <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
          <Heading size="md" mb="10px">{t("settings.cache.title","Inference Cache")}</Heading>
          <Text textStyle="sm" color="gray.600" mb="8px">{t("settings.cache.desc","Files downloaded for local playback/table view")}</Text>
          <HStack justify="space-between" align="center">
            <VStack align="start" gap="1">
              <Text textStyle="sm" color="gray.700">{t("settings.cache.total","Total cached size")}</Text>
              {cacheError ? (
                <Text textStyle="xs" color="red.500">{cacheError}</Text>
              ) : (
                <Text textStyle="lg" fontWeight="bold">{loadingCache ? t("common.loading","Loading...") : humanizeBytes(cacheBytes || 0)}</Text>
              )}
            </VStack>
            <HStack gap="2">
              <Button size="sm" variant="outline" onClick={refreshCacheSize} disabled={loadingCache || clearing}>{t("common.refresh","Refresh")}</Button>
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <Button size="sm" colorPalette="red" disabled={loadingCache || clearing}>
                    {clearing ? t("common.clearing","Clearing...") : t("settings.cache.clear","Clear All")}
                  </Button>
                </Dialog.Trigger>
                <Portal>
                  <Dialog.Backdrop />
                  <Dialog.Positioner>
                    <Dialog.Content>
                      <Dialog.Header>
                        <Dialog.Title>{t("settings.cache.clear_title","Clear Cache")}</Dialog.Title>
                      </Dialog.Header>
                      <Dialog.Body>
                        <Text>{t("settings.cache.clear_confirm","Delete all locally cached files (videos and tables)?")}</Text>
                      </Dialog.Body>
                      <Dialog.Footer>
                        <Dialog.ActionTrigger asChild>
                          <Button variant="outline" disabled={clearing}>{t("common.cancel","Cancel")}</Button>
                        </Dialog.ActionTrigger>
                        <Dialog.ActionTrigger asChild>
                          <Button colorPalette="red" onClick={async () => {
                            if (clearing) return;
                            setClearing(true);
                            try {
                              const root = await getOpfsRoot();
                              await clearAllEntries(root);
                            } catch { /* ignore */ }
                            setClearing(false);
                            refreshCacheSize();
                          }} disabled={clearing}>{t("settings.cache.clear","Clear All")}</Button>
                        </Dialog.ActionTrigger>
                      </Dialog.Footer>
                      <Dialog.CloseTrigger asChild>
                        <CloseButton size="sm" />
                      </Dialog.CloseTrigger>
                    </Dialog.Content>
                  </Dialog.Positioner>
                </Portal>
              </Dialog.Root>
            </HStack>
          </HStack>
        </Box>

        {/* About card */}
        <AppInfoCard />

      </VStack>
    </HStack>
  );
}

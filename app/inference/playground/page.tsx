"use client";

import { Box, HStack, VStack, Heading, Text, Button, Input, Textarea, Select, createListCollection, Portal } from "@chakra-ui/react";
import NextImage from "next/image";
import { useState } from "react";
import { useI18n } from "@/components/i18n/LanguageProvider";

const taskOptions = createListCollection({
  items: [
    { label: "Object Detection", value: "object-detection" },
    { label: "Image to Text", value: "image-to-text" },
    { label: "Text to Image", value: "text-to-image" },
  ],
});

export default function Page() {
  const { t } = useI18n();
  const [taskType, setTaskType] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  function onPickFile(e: any) {
    const f = e?.target?.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setImageUrl((prev) => {
      if (prev) { try { URL.revokeObjectURL(prev); } catch { void 0; } }
      return url;
    });
  }

  return (
    <HStack justify="center">
      <VStack w={{ base: "90%", md: "70%" }} align="stretch" gap="16px" py="24px">
        <HStack justify="space-between">
          <HStack gap="3" align="center">
            <Heading size="2xl">{t("playground.title","Quick Playground ⚡")}</Heading>
            <Button size="xs" rounded="full" variant="subtle" colorPalette="teal">{t("inference.badge","Inference")}</Button>
          </HStack>
          <Button rounded="full" onClick={() => setRunning(true)} disabled={!taskType || running}>
            {running ? t("common.loading","Loading...") : t("common.start","Start")}
          </Button>
        </HStack>
        <Text textStyle="sm" color="gray.600">{t("playground.subtitle")}</Text>

        <VStack align="stretch" gap="16px">
          {/* Task */}
          <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
            <Text fontWeight="bold" mb="8px">Task</Text>
            <Select.Root
              collection={taskOptions}
              size="sm"
              width={{ base: "100%", md: "50%" }}
              value={taskType ? [taskType] : []}
              onValueChange={(details: any) => setTaskType(details?.value?.[0] ?? "")}
            >
              <Select.HiddenSelect />
              <Select.Control>
                <Select.Trigger>
                  <Select.ValueText placeholder="Select task" />
                </Select.Trigger>
                <Select.IndicatorGroup>
                  <Select.Indicator />
                </Select.IndicatorGroup>
              </Select.Control>
              <Portal>
                <Select.Positioner>
                  <Select.Content>
                    {taskOptions.items.map((item) => (
                      <Select.Item item={item} key={item.value}>
                        {item.label}
                        <Select.ItemIndicator />
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Positioner>
              </Portal>
            </Select.Root>
          </Box>

          {/* Inputs by task */}
          {taskType === "text-to-image" && (
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="8px">Prompt</Text>
              <Textarea placeholder="A cat astronaut, watercolor style" size="sm" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <Text mt="2" textStyle="xs" color="gray.500">Backend not implemented yet. This is a mock UI.</Text>
              <HStack gap="8px" mt="12px">
                {[1,2,3,4].map((i) => (
                  <Box key={i} w="120px" h="120px" bg="gray.100" borderWidth="1px" rounded="md" />
                ))}
              </HStack>
            </Box>
          )}

          {(taskType === "image-to-text" || taskType === "object-detection") && (
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="8px">Input Image</Text>
              <Input type="file" accept="image/*" size="sm" onChange={onPickFile} />
              {imageUrl && (
                <Box mt="12px" rounded="md" overflow="hidden" borderWidth="1px">
                  <NextImage src={imageUrl} alt="preview" width={800} height={600} style={{ width: "100%", height: "auto" }} />
                </Box>
              )}
              {taskType === "image-to-text" && (
                <>
                  <Text fontWeight="bold" mt="12px" mb="8px">Prompt (optional)</Text>
                  <Input placeholder="e.g., Describe the scene" size="sm" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                </>
              )}
              <Text mt="2" textStyle="xs" color="gray.500">Backend not implemented yet. This is a mock UI.</Text>
              <Box mt="12px" p="10px" rounded="md" borderWidth="1px" bg="white">
                <Text textStyle="sm" color="gray.600">Result will appear here.</Text>
              </Box>
            </Box>
          )}
        </VStack>
      </VStack>
    </HStack>
  );
}

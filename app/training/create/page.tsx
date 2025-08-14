"use client";

import {
  Box,
  HStack,
  VStack,
  Heading,
  Text,
  Button,
  Input,
  Select,
  createListCollection,
  Portal,
  Stack,
  CheckboxGroup,
  Checkbox,
  Skeleton,
  InputGroup,
  Slider,
  Badge,
} from "@chakra-ui/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider";
import { extractDatasetNames, extractRows } from "@/components/surreal/normalize";
import { LuSearch } from "react-icons/lu";
import { useRouter } from "next/navigation";
import { encodeBase64Utf8 } from "@/components/utils/base64";
import { useI18n } from "@/components/i18n/LanguageProvider";

const MODEL_OPTIONS_BY_TASK: Record<string, { label: string; value: string }[]> = {
  "object-detection": [
    { label: "YOLOv8", value: "yolov8" },
    { label: "YOLOv9", value: "yolov9" },
  ],
  "image-to-text": [
    { label: "BLIP-2", value: "blip2" },
    { label: "ViT-GPT2", value: "vit-gpt2" },
  ],
  "text-to-image": [
    { label: "Stable Diffusion 1.5", value: "sd15" },
    { label: "Stable Diffusion XL", value: "sdxl" },
  ],
};

const taskOptions = createListCollection({
  items: [
    { label: "Object Detection", value: "object-detection" },
    { label: "Image to Text", value: "image-to-text" },
    { label: "Text to Image", value: "text-to-image" },
  ],
});

// chart types removed with charts

export default function Page() {
  const { t } = useI18n();
  // SurrealDB datasets
  const surreal = useSurrealClient();
  const { isSuccess } = useSurreal();
  const router = useRouter();

  const { data: datasets = [], isPending, isError, error, refetch } = useQuery({
    queryKey: ["datasets-for-training"],
    enabled: isSuccess,
    queryFn: async () => {
      const res = await surreal.query("SELECT dataset FROM file GROUP BY dataset;");
      return extractDatasetNames(res);
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [taskType, setTaskType] = useState<string>("");
  const modelItems = useMemo(() => (taskType ? (MODEL_OPTIONS_BY_TASK[taskType] ?? []) : []), [taskType]);
  const modelCollection = useMemo(() => createListCollection({ items: modelItems }), [modelItems]);
  const [modelValue, setModelValue] = useState<string>("");
  const [jobName, setJobName] = useState<string>("");
  const [trainSplit, setTrainSplit] = useState<number>(80);
  const [epochs, setEpochs] = useState<number | "">(50);
  const [batchSize, setBatchSize] = useState<number | "">(16);
  useEffect(() => {
    // Reset model if task changes to a set that doesn't include current model
    if (!taskType) { setModelValue(""); return; }
    const values = new Set(modelItems.map((i) => i.value));
    if (!values.has(modelValue)) setModelValue("");
  }, [taskType, modelItems]);
  // Object Detection labels state and query
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const {
    data: mergedLabels = [],
    isPending: labelsPending,
    isError: labelsIsError,
    error: labelsError,
    refetch: refetchLabels,
  } = useQuery({
    queryKey: ["merged-labels", taskType, [...selectedDatasets].sort()],
    enabled: isSuccess && taskType === "object-detection" && selectedDatasets.length > 0,
    queryFn: async () => {
      const names: string[] = [];
      for (const d of selectedDatasets) {
        try {
          const res = await surreal.query("SELECT name FROM label WHERE dataset == $dataset", { dataset: d });
          const rows = extractRows<any>(res);
          for (const r of rows) {
            const n = (r?.name ?? "").toString();
            if (n) names.push(n);
          }
        } catch { void 0; }
      }
      const uniq = Array.from(new Set(names));
      uniq.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      return uniq;
    },
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    setSelectedLabels([]);
  }, [taskType, selectedDatasets.join("|")]);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const filteredDatasets = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return datasets;
    return datasets.filter((n) => n.toLowerCase().includes(q));
  }, [datasets, deferredQuery]);
  const canStart = useMemo(() => {
    const datasetsOk = selectedDatasets.length > 0;
    const labelsOk = taskType !== "object-detection" || selectedLabels.length > 0;
    return datasetsOk && labelsOk;
  }, [selectedDatasets, taskType, selectedLabels]);

  // Load existing training job by name (to lock / populate when in progress)
  const trimmedJobName = (jobName || "").trim();
  const { data: existingJob, refetch: refetchJob } = useQuery({
    queryKey: ["training-job", trimmedJobName],
    enabled: isSuccess && !!trimmedJobName,
    queryFn: async () => {
      const res = await surreal.query(
        "SELECT * FROM training_job WHERE name == $name ORDER BY updatedAt DESC LIMIT 1",
        { name: trimmedJobName },
      );
      const rows = extractRows<any>(res);
      return rows[0] || null;
    },
    staleTime: 2000,
    refetchOnWindowFocus: false,
  });

  const locked = useMemo(() => (existingJob?.status === "ProcessWaiting"), [existingJob?.status]);

  useEffect(() => {
    if (existingJob) {
      // Populate fields from job (view-only when locked)
      if (typeof existingJob.taskType === "string") setTaskType(existingJob.taskType);
      if (typeof existingJob.model === "string") setModelValue(existingJob.model);
      if (Array.isArray(existingJob.datasets)) setSelectedDatasets(existingJob.datasets);
      if (Array.isArray(existingJob.labels)) setSelectedLabels(existingJob.labels);
      if (typeof existingJob.splitTrain === "number") setTrainSplit(existingJob.splitTrain);
      if (typeof existingJob.epochs === "number") setEpochs(existingJob.epochs);
      if (typeof existingJob.batchSize === "number") setBatchSize(existingJob.batchSize);
    } else {
      // no-op
    }
     
  }, [existingJob]);

  async function handleStart() {
    if (!trimmedJobName || !taskType || !modelValue || selectedDatasets.length === 0) return;
    const payload = {
      status: "ProcessWaiting",
      taskType,
      model: modelValue,
      datasets: selectedDatasets,
      labels: selectedLabels,
      epochs: typeof epochs === "number" ? epochs : undefined,
      batchSize: typeof batchSize === "number" ? batchSize : undefined,
      splitTrain: trainSplit,
      splitTest: 100 - trainSplit,
    };
    try {
      // Upsert by name
      const check = await surreal.query("SELECT id FROM training_job WHERE name == $name LIMIT 1", { name: trimmedJobName });
      const rows = extractRows<any>(check);
      if (rows.length > 0) {
        await surreal.query(
          "UPDATE training_job SET status = 'ProcessWaiting', taskType = $taskType, model = $model, datasets = $datasets, labels = $labels, epochs = $epochs, batchSize = $batchSize, splitTrain = $splitTrain, splitTest = $splitTest, updatedAt = time::now() WHERE name == $name",
          { name: trimmedJobName, ...payload },
        );
      } else {
        await surreal.query(
          "CREATE training_job CONTENT { name: $name, status: 'ProcessWaiting', taskType: $taskType, model: $model, datasets: $datasets, labels: $labels, epochs: $epochs, batchSize: $batchSize, splitTrain: $splitTrain, splitTest: $splitTest, createdAt: time::now(), updatedAt: time::now() }",
          { name: trimmedJobName, ...payload },
        );
      }
      refetchJob();
      router.push(`/training/opened-job?j=${encodeBase64Utf8(trimmedJobName)}`);
    } catch (e) {
      // swallow
    }
  }

  return (
    <HStack justify="center">
      <VStack w="70%" align="stretch" gap="24px" py="24px">
        {/* Header */}
        <HStack justify="space-between">
          <HStack gap="3" align="center">
            <Heading size="2xl">{t("training.create.title","Create Training Job 🎛️")}</Heading>
            <Badge rounded="full" variant="subtle" colorPalette="orange">{t("training.badge","Training")}</Badge>
          </HStack>
          <HStack gap="2">
            <Button size="sm" rounded="full" colorPalette="green" onClick={handleStart} disabled={locked || !canStart || !trimmedJobName || !taskType || !modelValue}>{t("common.start","Start")}</Button>
          </HStack>
        </HStack>
        <Text textStyle="sm" color="gray.600">{t("training.create.subtitle")}</Text>

        <HStack align="flex-start" justify="center" gap="24px">
          {/* Left: dataset selection */}
          <VStack w={{ base: "100%", md: "50%" }} align="stretch" gap="16px">
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="12px">{t("datasets.panel","Datasets")}</Text>
              <InputGroup
                flex="1"
                startElement={<LuSearch />}
                endElement={
                  query ? (
                    <Button size="xs" variant="ghost" onClick={() => setQuery("")} disabled={locked}>{t("common.clear","Clear")}</Button>
                  ) : undefined
                }
              >
                <Input
                  placeholder={t("datasets.search.placeholder","Search datasets")}
                  size="sm"
                  variant="flushed"
                  aria-label="Search datasets by name"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={locked}
                />
              </InputGroup>
              <HStack mt="10px" justify="space-between">
                <Text textStyle="xs" color="gray.500">{selectedDatasets.length} {t("datasets.selected_suffix","selected")}</Text>
                <HStack gap="1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSelectedDatasets(filteredDatasets)}
                    disabled={locked || filteredDatasets.length === 0}
                  >
                    {t("datasets.select_filtered","Select filtered")}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setSelectedDatasets([])} disabled={locked}>{t("common.clear","Clear")}</Button>
                </HStack>
              </HStack>
              <Box mt="8px">
                {isPending ? (
                  <VStack align="stretch" gap="2">
                    <Skeleton h="20px" />
                    <Skeleton h="20px" />
                    <Skeleton h="20px" />
                  </VStack>
                ) : isError ? (
                  <HStack justify="space-between" align="center">
                    <Text color="red.500" textStyle="sm">Failed to load datasets: {String((error as any)?.message ?? error)}</Text>
                    <Button size="xs" variant="outline" onClick={() => refetch()}>{t("common.retry","Retry")}</Button>
                  </HStack>
                ) : (
                  <CheckboxGroup
                    value={selectedDatasets}
                    onValueChange={(e: any) => {
                      const next = (e?.value ?? e) as string[];
                      setSelectedDatasets(next);
                    }}
                  >
                    <VStack align="stretch" gap="1" maxH="340px" overflowY="auto" pr="2">
                      {filteredDatasets.map((name) => (
                        <Checkbox.Root key={name} value={name} disabled={locked}>
                          <Checkbox.HiddenInput />
                          <Checkbox.Control />
                          <Checkbox.Label>{name}</Checkbox.Label>
                        </Checkbox.Root>
                      ))}
                      {filteredDatasets.length === 0 && (
                        <Text textStyle="sm" color="gray.500">{t("datasets.none","No datasets")}</Text>
                      )}
                    </VStack>
                  </CheckboxGroup>
                )}
              </Box>
            </Box>
          </VStack>

          {/* Middle: configuration */}
          <VStack w={{ base: "100%", md: "50%" }} align="stretch" gap="16px">
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="12px">{t("configuration.panel","Configuration")}</Text>

              <Stack gap="14px">
                {/* Job Name */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">{t("training.job_name","Job Name")}</Text>
                  <Input
                    placeholder="my-training-job"
                    size="sm"
                    variant="flushed"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                  />
                </Box>
                {/* Task Type */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">{t("training.task_type","Task Type")}</Text>
                  <Select.Root
                    collection={taskOptions}
                    size="sm"
                    width="100%"
                    value={taskType ? [taskType] : []}
                    onValueChange={(details: any) => setTaskType(details?.value?.[0] ?? "")}
                    disabled={locked}
                  >
                    <Select.HiddenSelect />
                    <Select.Control>
                      <Select.Trigger>
                        <Select.ValueText placeholder={t("training.task_type","Task Type")} />
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

                {/* Model */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">{t("training.model","Model")}</Text>
                  <Select.Root
                    collection={modelCollection}
                    size="sm"
                    width="100%"
                    value={modelValue ? [modelValue] : []}
                    onValueChange={(details: any) => setModelValue(details?.value?.[0] ?? "")}
                    disabled={!taskType || locked}
                  >
                    <Select.HiddenSelect />
                    <Select.Control>
                      <Select.Trigger>
                        <Select.ValueText placeholder={taskType ? t("inference.select_model","Select model") : t("inference.select_task_first","Select task type first")} />
                      </Select.Trigger>
                      <Select.IndicatorGroup>
                        <Select.Indicator />
                      </Select.IndicatorGroup>
                    </Select.Control>
                    <Portal>
                      <Select.Positioner>
                        <Select.Content>
                          {modelItems.map((item) => (
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

                {/* Labels (Object Detection) */}
                {taskType === "object-detection" && (
                  <Box>
                    <HStack justify="space-between" align="center" mb="6px">
                      <Text textStyle="sm" color="gray.600">{t("training.labels","Labels")}</Text>
                      <Text textStyle="xs" color="gray.500">{selectedLabels.length} {t("datasets.selected_suffix","selected")}</Text>
                    </HStack>
                    {selectedDatasets.length === 0 ? (
                      <Text textStyle="sm" color="gray.500">{t("training.labels.select_datasets")}</Text>
                    ) : labelsPending ? (
                      <VStack align="stretch" gap="2">
                        <Skeleton h="18px" />
                        <Skeleton h="18px" />
                        <Skeleton h="18px" />
                      </VStack>
                    ) : labelsIsError ? (
                      <HStack justify="space-between" align="center">
                        <Text color="red.500" textStyle="sm">Failed to load labels: {String((labelsError as any)?.message ?? labelsError)}</Text>
                        <Button size="xs" variant="outline" onClick={() => refetchLabels()}>{t("common.retry","Retry")}</Button>
                      </HStack>
                    ) : mergedLabels.length === 0 ? (
                      <Text textStyle="sm" color="gray.500">{t("training.labels.none")}</Text>
                    ) : (
                      <>
                        <HStack mb="4" gap="2">
                          <Button size="xs" variant="ghost" onClick={() => setSelectedLabels(mergedLabels)} disabled={locked}>{t("training.select_all","Select all")}</Button>
                          <Button size="xs" variant="ghost" onClick={() => setSelectedLabels([])} disabled={locked}>{t("common.clear","Clear")}</Button>
                        </HStack>
                        <CheckboxGroup
                          value={selectedLabels}
                          onValueChange={(e: any) => setSelectedLabels((e?.value ?? e) as string[])}
                        >
                          <VStack align="stretch" gap="1" maxH="200px" overflowY="auto" pr="2">
                            {mergedLabels.map((name) => (
                              <Checkbox.Root key={name} value={name} disabled={locked}>
                                <Checkbox.HiddenInput />
                                <Checkbox.Control />
                                <Checkbox.Label>{name}</Checkbox.Label>
                              </Checkbox.Root>
                            ))}
                          </VStack>
                        </CheckboxGroup>
                      </>
                    )}
                  </Box>
                )}

                {/* Datasets (display-only of selected) */}
                <Box>
                  <HStack justify="space-between" align="center" mb="6px">
                    <Text textStyle="sm" color="gray.600">{t("training.datasets","Datasets")}</Text>
                    <Text textStyle="xs" color="gray.500">{selectedDatasets.length} {t("datasets.selected_suffix","selected")}</Text>
                  </HStack>
                  <VStack align="stretch" gap="1" maxH="140px" overflowY="auto" pr="2">
                    {selectedDatasets.map((name) => (
                      <Text key={name} textStyle="sm">• {name}</Text>
                    ))}
                    {selectedDatasets.length === 0 && (
                      <Text textStyle="sm" color="gray.500">{t("datasets.none","No datasets")}</Text>
                    )}
                  </VStack>
                </Box>

                {/* Train / Test Split */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">{t("training.train_test_split","Train / Test Split")}</Text>
                  <Slider.Root
                    size="sm"
                    value={[trainSplit]}
                    min={5}
                    max={95}
                    step={5}
                    disabled={locked}
                    onValueChange={(details: any) => {
                      const v = Number(details?.value?.[0] ?? details?.value ?? trainSplit);
                      if (Number.isFinite(v)) setTrainSplit(Math.max(5, Math.min(95, Math.round(v))));
                    }}
                  >
                    <HStack justify="space-between" mb="2">
                      <Slider.Label>{t("training.train_test_ratio","Train : Test")}</Slider.Label>
                      <Text textStyle="sm">{trainSplit} : {100 - trainSplit}</Text>
                    </HStack>
                    <Slider.Control>
                      <Slider.Track>
                        <Slider.Range />
                      </Slider.Track>
                      <Slider.Thumbs rounded="l1" />
                    </Slider.Control>
                  </Slider.Root>
                </Box>

                {/* Hyperparameters */}
                <HStack gap="12px">
                  <Box flex="1">
                    <Text textStyle="sm" color="gray.600" mb="6px">Epochs</Text>
                    <Input placeholder="50" size="sm" variant="flushed" value={epochs === "" ? "" : String(epochs)} onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return setEpochs("");
                      const n = Number(v);
                      if (Number.isFinite(n)) setEpochs(Math.max(1, Math.floor(n)));
                    }} disabled={locked} />
                  </Box>
                  <Box flex="1">
                    <Text textStyle="sm" color="gray.600" mb="6px">Batch Size</Text>
                    <Input placeholder="16" size="sm" variant="flushed" value={batchSize === "" ? "" : String(batchSize)} onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return setBatchSize("");
                      const n = Number(v);
                      if (Number.isFinite(n)) setBatchSize(Math.max(1, Math.floor(n)));
                    }} disabled={locked} />
                  </Box>
                </HStack>
              </Stack>
            </Box>
          </VStack>

          {/* Right column removed (Status and Charts) as requested */}
        </HStack>
      </VStack>
    </HStack>
  );
}

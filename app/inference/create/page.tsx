"use client"

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
} from "@chakra-ui/react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"
import { extractDatasetNames, extractRows } from "@/components/surreal/normalize"
import { LuSearch } from "react-icons/lu"
import { useRouter } from "next/navigation"
import { encodeBase64Utf8 } from "@/components/utils/base64"

const INTERNET_MODELS_BY_TASK: Record<string, { label: string; value: string }[]> = {
  "object-detection": [
    { label: "YOLOv8 (internet)", value: "yolov8" },
    { label: "YOLOv9 (internet)", value: "yolov9" },
  ],
  "image-to-text": [
    { label: "BLIP-2 (internet)", value: "blip2" },
    { label: "ViT-GPT2 (internet)", value: "vit-gpt2" },
  ],
  "text-to-image": [
    { label: "Stable Diffusion 1.5 (internet)", value: "sd15" },
    { label: "Stable Diffusion XL (internet)", value: "sdxl" },
  ],
}

const taskOptions = createListCollection({
  items: [
    { label: "Object Detection", value: "object-detection" },
    { label: "Image to Text", value: "image-to-text" },
    { label: "Text to Image", value: "text-to-image" },
  ],
})

export default function Page() {
  const surreal = useSurrealClient()
  const { isSuccess } = useSurreal()
  const router = useRouter()

  // Datasets
  const { data: datasets = [], isPending, isError, error, refetch } = useQuery({
    queryKey: ["datasets-for-inference"],
    enabled: isSuccess,
    queryFn: async () => {
      const res = await surreal.query("SELECT dataset FROM file GROUP BY dataset;")
      return extractDatasetNames(res)
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })

  // Completed training jobs for selectable models
  const { data: completedTrainingJobs = [] } = useQuery({
    queryKey: ["completed-training-jobs"],
    enabled: isSuccess,
    queryFn: async () => {
      const res = await surreal.query("SELECT name FROM training_job WHERE status IN ['Complete', 'Completed'] ")
      const rows = extractRows<any>(res)
      const names = rows.map((r: any) => String(r?.name ?? "")).filter(Boolean)
      return names
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })

  // Form state
  const [jobName, setJobName] = useState<string>("")
  const trimmedJobName = (jobName || "").trim()
  const [taskType, setTaskType] = useState<string>("")
  const [modelSource, setModelSource] = useState<"internet" | "trained">("internet")
  const [internetModel, setInternetModel] = useState<string>("")
  const [trainedModelName, setTrainedModelName] = useState<string>("")
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const filteredDatasets = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    if (!q) return datasets
    return datasets.filter((n) => n.toLowerCase().includes(q))
  }, [datasets, deferredQuery])

  const internetModelItems = useMemo(() => (taskType ? (INTERNET_MODELS_BY_TASK[taskType] ?? []) : []), [taskType])
  const internetModelCollection = useMemo(() => createListCollection({ items: internetModelItems }), [internetModelItems])
  useEffect(() => {
    // Reset models when task or source changes
    setInternetModel("")
    setTrainedModelName("")
  }, [taskType, modelSource])

  // Lock when the same job is in progress
  const { data: existingJob } = useQuery({
    queryKey: ["inference-job", trimmedJobName],
    enabled: isSuccess && !!trimmedJobName,
    queryFn: async () => {
      const res = await surreal.query(
        "SELECT * FROM inference_job WHERE name == $name ORDER BY updatedAt DESC LIMIT 1",
        { name: trimmedJobName },
      )
      const rows = extractRows<any>(res)
      return rows[0] || null
    },
    staleTime: 2000,
    refetchOnWindowFocus: false,
  })
  const locked = existingJob?.status === 'ProcessWaiting'

  const chosenModel = modelSource === "internet" ? internetModel : trainedModelName
  const canStart = !!trimmedJobName && !!taskType && !!chosenModel && selectedDatasets.length > 0

  async function handleStart() {
    if (!canStart) return
    const payload = {
      status: "ProcessWaiting",
      taskType,
      model: chosenModel,
      modelSource,
      datasets: selectedDatasets,
    }
    try {
      const check = await surreal.query("SELECT id FROM inference_job WHERE name == $name LIMIT 1", { name: trimmedJobName })
      const rows = extractRows<any>(check)
      if (rows.length > 0) {
        await surreal.query(
          "UPDATE inference_job SET status = 'ProcessWaiting', taskType = $taskType, model = $model, modelSource = $modelSource, datasets = $datasets, updatedAt = time::now() WHERE name == $name",
          { name: trimmedJobName, ...payload },
        )
      } else {
        await surreal.query(
          "CREATE inference_job CONTENT { name: $name, status: 'ProcessWaiting', taskType: $taskType, model: $model, modelSource: $modelSource, datasets: $datasets, createdAt: time::now(), updatedAt: time::now() }",
          { name: trimmedJobName, ...payload },
        )
      }
      router.push(`/inference/opened-job?j=${encodeBase64Utf8(trimmedJobName)}`)
    } catch { }
  }

  return (
    <HStack justify="center">
      <VStack w="70%" align="stretch" gap="24px" py="24px">
        {/* Header */}
        <HStack justify="space-between">
          <Heading size="2xl">Create Inference Job</Heading>
          <HStack gap="2">
            <Button size="sm" rounded="full" colorPalette="green" onClick={handleStart} disabled={locked || !canStart}>Start</Button>
          </HStack>
        </HStack>

        <HStack align="flex-start" justify="center" gap="24px">
          {/* Left: Datasets */}
          <VStack w={{ base: "100%", md: "50%" }} align="stretch" gap="16px">
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="12px">Datasets</Text>
              <InputGroup
                flex="1"
                startElement={<LuSearch />}
                endElement={
                  query ? (
                    <Button size="xs" variant="ghost" onClick={() => setQuery("")} disabled={locked}>Clear</Button>
                  ) : undefined
                }
              >
                <Input
                  placeholder="Search datasets"
                  size="sm"
                  variant="flushed"
                  aria-label="Search datasets by name"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={locked}
                />
              </InputGroup>
              <HStack mt="10px" justify="space-between">
                <Text textStyle="xs" color="gray.500">{selectedDatasets.length} selected</Text>
                <HStack gap="1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSelectedDatasets(filteredDatasets)}
                    disabled={locked || filteredDatasets.length === 0}
                  >
                    Select filtered
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setSelectedDatasets([])} disabled={locked}>Clear</Button>
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
                    <Button size="xs" variant="outline" onClick={() => refetch()}>Retry</Button>
                  </HStack>
                ) : (
                  <CheckboxGroup
                    value={selectedDatasets}
                    onValueChange={(e: any) => {
                      const next = (e?.value ?? e) as string[]
                      setSelectedDatasets(next)
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
                        <Text textStyle="sm" color="gray.500">No datasets</Text>
                      )}
                    </VStack>
                  </CheckboxGroup>
                )}
              </Box>
            </Box>
          </VStack>

          {/* Right: Configuration */}
          <VStack w={{ base: "100%", md: "50%" }} align="stretch" gap="16px">
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="12px">Configuration</Text>

              <Stack gap="14px">
                {/* Job Name */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">Job Name</Text>
                  <Input
                    placeholder="my-inference-job"
                    size="sm"
                    variant="flushed"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                  />
                </Box>
                {/* Task Type */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">Task Type</Text>
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
                        <Select.ValueText placeholder="Select task type" />
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

                {/* Model Source */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">Model Source</Text>
                  <HStack gap="2">
                    <Button size="xs" rounded="full" variant={modelSource === 'internet' ? 'solid' : 'outline'} onClick={() => setModelSource('internet')}>Internet</Button>
                    <Button size="xs" rounded="full" variant={modelSource === 'trained' ? 'solid' : 'outline'} onClick={() => setModelSource('trained')}>Trained</Button>
                  </HStack>
                </Box>

                {/* Internet Model */}
                {modelSource === 'internet' && (
                  <Box>
                    <Text textStyle="sm" color="gray.600" mb="6px">Internet Model</Text>
                    <Select.Root
                      collection={internetModelCollection}
                      size="sm"
                      width="100%"
                      value={internetModel ? [internetModel] : []}
                      onValueChange={(details: any) => setInternetModel(details?.value?.[0] ?? "")}
                      disabled={!taskType || locked}
                    >
                      <Select.HiddenSelect />
                      <Select.Control>
                        <Select.Trigger>
                          <Select.ValueText placeholder={taskType ? "Select model" : "Select task type first"} />
                        </Select.Trigger>
                        <Select.IndicatorGroup>
                          <Select.Indicator />
                        </Select.IndicatorGroup>
                      </Select.Control>
                      <Portal>
                        <Select.Positioner>
                          <Select.Content>
                            {internetModelItems.map((item) => (
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
                )}

                {/* Trained Model */}
                {modelSource === 'trained' && (
                  <Box>
                    <Text textStyle="sm" color="gray.600" mb="6px">Completed Training Job</Text>
                    <Select.Root
                      // Build collection inline to avoid stale values
                      collection={createListCollection({ items: completedTrainingJobs.map((n) => ({ label: n, value: n })) })}
                      size="sm"
                      width="100%"
                      value={trainedModelName ? [trainedModelName] : []}
                      onValueChange={(details: any) => setTrainedModelName(details?.value?.[0] ?? "")}
                      disabled={!taskType || locked}
                    >
                      <Select.HiddenSelect />
                      <Select.Control>
                        <Select.Trigger>
                          <Select.ValueText placeholder={completedTrainingJobs.length ? "Select completed job" : "No completed jobs"} />
                        </Select.Trigger>
                        <Select.IndicatorGroup>
                          <Select.Indicator />
                        </Select.IndicatorGroup>
                      </Select.Control>
                      <Portal>
                        <Select.Positioner>
                          <Select.Content>
                            {completedTrainingJobs.map((name) => (
                              <Select.Item key={name} item={{ label: name, value: name }}>
                                {name}
                                <Select.ItemIndicator />
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select.Positioner>
                      </Portal>
                    </Select.Root>
                  </Box>
                )}

                {/* Datasets (display-only of selected) */}
                <Box>
                  <HStack justify="space-between" align="center" mb="6px">
                    <Text textStyle="sm" color="gray.600">Datasets</Text>
                    <Text textStyle="xs" color="gray.500">{selectedDatasets.length} selected</Text>
                  </HStack>
                  <VStack align="stretch" gap="1" maxH="140px" overflowY="auto" pr="2">
                    {selectedDatasets.map((name) => (
                      <Text key={name} textStyle="sm">• {name}</Text>
                    ))}
                    {selectedDatasets.length === 0 && (
                      <Text textStyle="sm" color="gray.500">No datasets selected</Text>
                    )}
                  </VStack>
                </Box>
              </Stack>
            </Box>
          </VStack>
        </HStack>
      </VStack>
    </HStack>
  )
}


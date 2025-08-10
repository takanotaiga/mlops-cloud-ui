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
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
  AspectRatio,
  CheckboxGroup,
  Checkbox,
  Skeleton,
  InputGroup,
  Slider,
} from "@chakra-ui/react"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"
import { extractDatasetNames, extractRows } from "@/components/surreal/normalize"
import { LuSearch } from "react-icons/lu"

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
}

const taskOptions = createListCollection({
  items: [
    { label: "Object Detection", value: "object-detection" },
    { label: "Image to Text", value: "image-to-text" },
    { label: "Text to Image", value: "text-to-image" },
  ],
})

type Point = Record<string, number | string>

function LineSvg({ data, yKey, color = "#2b6cb0" }: { data: Point[]; yKey: string; color?: string }) {
  const width = 800
  const height = 300
  const pad = { l: 40, r: 12, t: 12, b: 24 }
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const xs = data.map((_, i) => i)
  const ys = data.map((d) => Number(d[yKey] as any))
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const ySpan = yMax - yMin || 1
  const toX = (i: number) => pad.l + (innerW * i) / Math.max(1, xs.length - 1)
  const toY = (y: number) => pad.t + innerH - ((y - yMin) / ySpan) * innerH
  const dAttr = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${toX(i)},${toY(Number(d[yKey] as any))}`)
    .join(" ")
  const xTicks = 5
  const yTicks = 4
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <rect x="0" y="0" width={width} height={height} fill="white" />
      {[...Array(xTicks)].map((_, i) => {
        const x = pad.l + (innerW * i) / (xTicks - 1)
        return <line key={`vx-${i}`} x1={x} x2={x} y1={pad.t} y2={pad.t + innerH} stroke="#eee" />
      })}
      {[...Array(yTicks)].map((_, i) => {
        const y = pad.t + (innerH * i) / (yTicks - 1)
        return <line key={`hz-${i}`} x1={pad.l} x2={pad.l + innerW} y1={y} y2={y} stroke="#eee" />
      })}
      <path d={dAttr} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  )
}

export default function Page() {
  // SurrealDB datasets
  const surreal = useSurrealClient()
  const { isSuccess } = useSurreal()

  const { data: datasets = [], isPending, isError, error, refetch } = useQuery({
    queryKey: ["datasets-for-training"],
    enabled: isSuccess,
    queryFn: async () => {
      const res = await surreal.query("SELECT dataset FROM file GROUP BY dataset;")
      return extractDatasetNames(res)
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })

  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([])
  const [taskType, setTaskType] = useState<string>("")
  const modelItems = useMemo(() => (taskType ? (MODEL_OPTIONS_BY_TASK[taskType] ?? []) : []), [taskType])
  const modelCollection = useMemo(() => createListCollection({ items: modelItems }), [modelItems])
  const [modelValue, setModelValue] = useState<string>("")
  const [jobName, setJobName] = useState<string>("")
  const [trainSplit, setTrainSplit] = useState<number>(80)
  useEffect(() => {
    // Reset model if task changes to a set that doesn't include current model
    if (!taskType) { setModelValue(""); return }
    const values = new Set(modelItems.map((i) => i.value))
    if (!values.has(modelValue)) setModelValue("")
  }, [taskType, modelItems])
  // Object Detection labels state and query
  const [selectedLabels, setSelectedLabels] = useState<string[]>([])
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
      const names: string[] = []
      for (const d of selectedDatasets) {
        try {
          const res = await surreal.query("SELECT name FROM label WHERE dataset == $dataset", { dataset: d })
          const rows = extractRows<any>(res)
          for (const r of rows) {
            const n = (r?.name ?? "").toString()
            if (n) names.push(n)
          }
        } catch { }
      }
      const uniq = Array.from(new Set(names))
      uniq.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      return uniq
    },
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    setSelectedLabels([])
  }, [taskType, selectedDatasets.join("|")])
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const filteredDatasets = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    if (!q) return datasets
    return datasets.filter((n) => n.toLowerCase().includes(q))
  }, [datasets, deferredQuery])
  const canStart = useMemo(() => selectedDatasets.length > 0, [selectedDatasets])

  return (
    <HStack justify="center">
      <VStack w="70%" align="stretch" gap="24px" py="24px">
        {/* Header */}
        <HStack justify="space-between">
          <Heading size="2xl">Training</Heading>
          <HStack gap="2">
            <Button size="sm" variant="outline" rounded="full">Stop</Button>
            <Button size="sm" rounded="full" colorPalette="green" disabled={!canStart}>Start</Button>
          </HStack>
        </HStack>

        <HStack align="flex-start" gap="24px">
          {/* Left: dataset selection */}
          <VStack w={{ base: "100%", md: "28%" }} align="stretch" gap="16px">
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="12px">Datasets</Text>
              <InputGroup
                flex="1"
                startElement={<LuSearch />}
                endElement={
                  query ? (
                    <Button size="xs" variant="ghost" onClick={() => setQuery("")}>Clear</Button>
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
                />
              </InputGroup>
              <HStack mt="10px" justify="space-between">
                <Text textStyle="xs" color="gray.500">{selectedDatasets.length} selected</Text>
                <HStack gap="1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSelectedDatasets(filteredDatasets)}
                    disabled={filteredDatasets.length === 0}
                  >
                    Select filtered
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setSelectedDatasets([])}>Clear</Button>
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
                        <Checkbox.Root key={name} value={name}>
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

          {/* Middle: configuration */}
          <VStack w={{ base: "100%", md: "28%" }} align="stretch" gap="16px">
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="12px">Configuration</Text>

              <Stack gap="14px">
                {/* Job Name */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">Job Name</Text>
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
                  <Text textStyle="sm" color="gray.600" mb="6px">Task Type</Text>
                  <Select.Root
                    collection={taskOptions}
                    size="sm"
                    width="100%"
                    value={taskType ? [taskType] : []}
                    onValueChange={(details: any) => setTaskType(details?.value?.[0] ?? "")}
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

                {/* Model */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">Model</Text>
                  <Select.Root
                    collection={modelCollection}
                    size="sm"
                    width="100%"
                    value={modelValue ? [modelValue] : []}
                    onValueChange={(details: any) => setModelValue(details?.value?.[0] ?? "")}
                    disabled={!taskType}
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
                      <Text textStyle="sm" color="gray.600">Labels</Text>
                      <Text textStyle="xs" color="gray.500">{selectedLabels.length} selected</Text>
                    </HStack>
                    {selectedDatasets.length === 0 ? (
                      <Text textStyle="sm" color="gray.500">Select datasets to load labels</Text>
                    ) : labelsPending ? (
                      <VStack align="stretch" gap="2">
                        <Skeleton h="18px" />
                        <Skeleton h="18px" />
                        <Skeleton h="18px" />
                      </VStack>
                    ) : labelsIsError ? (
                      <HStack justify="space-between" align="center">
                        <Text color="red.500" textStyle="sm">Failed to load labels: {String((labelsError as any)?.message ?? labelsError)}</Text>
                        <Button size="xs" variant="outline" onClick={() => refetchLabels()}>Retry</Button>
                      </HStack>
                    ) : mergedLabels.length === 0 ? (
                      <Text textStyle="sm" color="gray.500">No labels found in selected datasets</Text>
                    ) : (
                      <>
                        <HStack mb="4" gap="2">
                          <Button size="xs" variant="ghost" onClick={() => setSelectedLabels(mergedLabels)}>Select all</Button>
                          <Button size="xs" variant="ghost" onClick={() => setSelectedLabels([])}>Clear</Button>
                        </HStack>
                        <CheckboxGroup
                          value={selectedLabels}
                          onValueChange={(e: any) => setSelectedLabels((e?.value ?? e) as string[])}
                        >
                          <VStack align="stretch" gap="1" maxH="200px" overflowY="auto" pr="2">
                            {mergedLabels.map((name) => (
                              <Checkbox.Root key={name} value={name}>
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

                {/* Train / Test Split */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">Train / Test Split</Text>
                  <Slider.Root
                    size="sm"
                    value={[trainSplit]}
                    min={5}
                    max={95}
                    step={5}
                    onValueChange={(details: any) => {
                      const v = Number(details?.value?.[0] ?? details?.value ?? trainSplit)
                      if (Number.isFinite(v)) setTrainSplit(Math.max(5, Math.min(95, Math.round(v))))
                    }}
                  >
                    <HStack justify="space-between" mb="2">
                      <Slider.Label>Train : Test</Slider.Label>
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
                    <Input placeholder="50" size="sm" variant="flushed" />
                  </Box>
                  <Box flex="1">
                    <Text textStyle="sm" color="gray.600" mb="6px">Batch Size</Text>
                    <Input placeholder="16" size="sm" variant="flushed" />
                  </Box>
                </HStack>
                {/* Removed Learning Rate and Weight Decay as requested */}
              </Stack>

              {/* Save Config button removed as requested */}
            </Box>

          </VStack>

          {/* Right: charts tabs */}
          <VStack flex="1" align="stretch" gap="16px">
            {/* Status above charts */}
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="8px">Status</Text>
              <Text textStyle="sm" color="gray.600">Idle. Press Start to begin training.</Text>
            </Box>
            <Box rounded="md" borderWidth="1px" bg="white" p="12px">
              <TabsRoot defaultValue="loss">
                <TabsList>
                  <TabsTrigger value="loss">Loss</TabsTrigger>
                  <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
                  <TabsTrigger value="gpu">GPU Memory Usage</TabsTrigger>
                </TabsList>
                <Box h="12px" />
                <TabsContent value="loss">
                  <AspectRatio ratio={16 / 9}>
                    <Box>
                      <LineSvg
                        data={[{ epoch: 1, value: 1.2 }, { epoch: 2, value: 0.9 }, { epoch: 3, value: 0.7 }, { epoch: 4, value: 0.55 }, { epoch: 5, value: 0.48 }, { epoch: 6, value: 0.42 }, { epoch: 7, value: 0.38 }, { epoch: 8, value: 0.35 }]}
                        yKey="value"
                        color="#E53E3E"
                      />
                    </Box>
                  </AspectRatio>
                </TabsContent>
                <TabsContent value="accuracy">
                  <AspectRatio ratio={16 / 9}>
                    <Box>
                      <LineSvg
                        data={[{ epoch: 1, value: 0.45 }, { epoch: 2, value: 0.55 }, { epoch: 3, value: 0.62 }, { epoch: 4, value: 0.7 }, { epoch: 5, value: 0.76 }, { epoch: 6, value: 0.8 }, { epoch: 7, value: 0.83 }, { epoch: 8, value: 0.86 }]}
                        yKey="value"
                        color="#2F855A"
                      />
                    </Box>
                  </AspectRatio>
                </TabsContent>
                <TabsContent value="gpu">
                  <AspectRatio ratio={16 / 9}>
                    <Box>
                      <LineSvg
                        data={[{ step: 0, value: 3000 }, { step: 1, value: 5500 }, { step: 2, value: 6200 }, { step: 3, value: 6400 }, { step: 4, value: 6400 }, { step: 5, value: 6500 }]}
                        yKey="value"
                        color="#3182CE"
                      />
                    </Box>
                  </AspectRatio>
                </TabsContent>
              </TabsRoot>
            </Box>
          </VStack>
        </HStack>
      </VStack>
    </HStack>
  )
}

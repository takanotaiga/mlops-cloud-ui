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
} from "@chakra-ui/react"

const modelOptions = createListCollection({
  items: [
    { label: "YOLOv8", value: "yolov8" },
    { label: "YOLOv9", value: "yolov9" },
    { label: "ResNet50", value: "resnet50" },
    { label: "ViT-Base", value: "vit-base" },
  ],
})

const datasetOptions = createListCollection({
  items: [
    { label: "Persons", value: "persons" },
    { label: "Vehicles", value: "vehicles" },
    { label: "COCO-subset", value: "coco" },
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
  return (
    <HStack justify="center">
      <VStack w="70%" align="stretch" gap="24px" py="24px">
        {/* Header */}
        <HStack justify="space-between">
          <Heading size="2xl">Training</Heading>
          <HStack gap="2">
            <Button size="sm" variant="outline" rounded="full">Stop</Button>
            <Button size="sm" rounded="full" colorPalette="green">Start</Button>
          </HStack>
        </HStack>

        <HStack align="flex-start" gap="24px">
          {/* Left: configuration */}
          <VStack w={{ base: "100%", md: "36%" }} align="stretch" gap="16px">
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="12px">Configuration</Text>

              <Stack gap="14px">
                {/* Model */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">Model</Text>
                  <Select.Root collection={modelOptions} size="sm" width="100%">
                    <Select.HiddenSelect />
                    <Select.Control>
                      <Select.Trigger>
                        <Select.ValueText placeholder="Select model" />
                      </Select.Trigger>
                      <Select.IndicatorGroup>
                        <Select.Indicator />
                      </Select.IndicatorGroup>
                    </Select.Control>
                    <Portal>
                      <Select.Positioner>
                        <Select.Content>
                          {modelOptions.items.map((item) => (
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

                {/* Dataset */}
                <Box>
                  <Text textStyle="sm" color="gray.600" mb="6px">Dataset</Text>
                  <Select.Root collection={datasetOptions} size="sm" width="100%">
                    <Select.HiddenSelect />
                    <Select.Control>
                      <Select.Trigger>
                        <Select.ValueText placeholder="Select dataset" />
                      </Select.Trigger>
                      <Select.IndicatorGroup>
                        <Select.Indicator />
                      </Select.IndicatorGroup>
                    </Select.Control>
                    <Portal>
                      <Select.Positioner>
                        <Select.Content>
                          {datasetOptions.items.map((item) => (
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
                <HStack gap="12px">
                  <Box flex="1">
                    <Text textStyle="sm" color="gray.600" mb="6px">Learning Rate</Text>
                    <Input placeholder="0.001" size="sm" variant="flushed" />
                  </Box>
                  <Box flex="1">
                    <Text textStyle="sm" color="gray.600" mb="6px">Weight Decay</Text>
                    <Input placeholder="0.0001" size="sm" variant="flushed" />
                  </Box>
                </HStack>
              </Stack>

              <HStack justify="flex-end" mt="16px">
                <Button size="sm" rounded="full">Save Config</Button>
              </HStack>
            </Box>

            {/* Logs / Status */}
            <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
              <Text fontWeight="bold" mb="8px">Status</Text>
              <Text textStyle="sm" color="gray.600">Idle. Press Start to begin training.</Text>
            </Box>
          </VStack>

          {/* Right: charts tabs */}
          <VStack flex="1" align="stretch" gap="16px">
            <Box rounded="md" borderWidth="1px" bg="white" p="12px">
              <TabsRoot defaultValue="loss">
                <TabsList>
                  <TabsTrigger value="loss">Loss</TabsTrigger>
                  <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
                  <TabsTrigger value="gpu">GPU Memory Usage</TabsTrigger>
                </TabsList>
                <Box h="12px" />
                <TabsContent value="loss">
                  <AspectRatio ratio={16/9}>
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
                  <AspectRatio ratio={16/9}>
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
                  <AspectRatio ratio={16/9}>
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

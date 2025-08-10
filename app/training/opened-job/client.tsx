"use client"

import { Box, Heading, HStack, VStack, Text, Button, Badge, Link, SkeletonText, Skeleton, Dialog, Portal, CloseButton, TabsRoot, TabsList, TabsTrigger, TabsContent, AspectRatio } from "@chakra-ui/react"
import NextLink from "next/link"
import { useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { decodeBase64Utf8 } from "@/components/utils/base64"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { extractRows } from "@/components/surreal/normalize"
import { useRouter } from "next/navigation"

type JobRow = {
  id: string
  name: string
  status?: string
  taskType?: string
  model?: string
  datasets?: string[]
  labels?: string[]
  epochs?: number
  batchSize?: number
  splitTrain?: number
  splitTest?: number
  createdAt?: string
  updatedAt?: string
}

function thingToString(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "object" && v !== null && "tb" in (v as any) && "id" in (v as any)) {
    const t = v as any
    const id = typeof t.id === "object" && t.id !== null ? ((t.id as any).toString?.() ?? JSON.stringify(t.id)) : String(t.id)
    return `${t.tb}:${id}`
  }
  return String(v)
}

export default function ClientOpenedJobPage() {
  const params = useSearchParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const jobName = useMemo(() => {
    const j = params.get("j")
    if (!j) return ""
    try { return decodeBase64Utf8(j) } catch { return "" }
  }, [params])

  const surreal = useSurrealClient()
  const { isSuccess } = useSurreal()
  const [removing, setRemoving] = useState(false)

  const { data: job, isPending, isError, error, refetch } = useQuery({
    queryKey: ["training-job-detail", jobName],
    enabled: isSuccess && !!jobName,
    queryFn: async (): Promise<JobRow | null> => {
      const res = await surreal.query("SELECT * FROM training_job WHERE name == $name ORDER BY updatedAt DESC LIMIT 1", { name: jobName })
      const rows = extractRows<any>(res)
      const r = rows[0]
      if (!r) return null
      return {
        id: thingToString(r?.id),
        name: String(r?.name ?? ""),
        status: r?.status,
        taskType: r?.taskType,
        model: r?.model,
        datasets: Array.isArray(r?.datasets) ? r.datasets : [],
        labels: Array.isArray(r?.labels) ? r.labels : [],
        epochs: typeof r?.epochs === 'number' ? r.epochs : undefined,
        batchSize: typeof r?.batchSize === 'number' ? r.batchSize : undefined,
        splitTrain: typeof r?.splitTrain === 'number' ? r.splitTrain : undefined,
        splitTest: typeof r?.splitTest === 'number' ? r.splitTest : undefined,
        createdAt: r?.createdAt,
        updatedAt: r?.updatedAt,
      }
    },
    refetchOnWindowFocus: false,
    staleTime: 2000,
  })

  function formatTimestamp(ts?: string): string {
    if (!ts) return ""
    const d = new Date(ts)
    if (isNaN(d.getTime())) return String(ts)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

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

  async function handleRemove() {
    if (!jobName || removing) return
    setRemoving(true)
    try {
      await surreal.query("DELETE training_job WHERE name == $name", { name: jobName })
      // Invalidate job list and navigate with refresh token to force reload
      queryClient.invalidateQueries({ queryKey: ["training-jobs"] })
      const r = Date.now().toString()
      router.push(`/training?r=${encodeURIComponent(r)}`)
    } catch {
      // ignore
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Box px="10%" py="20px">
      <HStack align="center" justify="space-between">
        <Heading size="2xl">
          <Link asChild color="black" _hover={{ textDecoration: "none", color: "black" }}>
            <NextLink href="/training">Training</NextLink>
          </Link>
          {" / "}
          {jobName || "(unknown)"}
        </Heading>
        <HStack>
          {job?.status === 'ProcessWaiting' && (
            <Button size="sm" rounded="full" variant="outline" onClick={async () => {
              if (!jobName) return
              try {
                await surreal.query("UPDATE training_job SET status = 'StopInterrept', updatedAt = time::now() WHERE name == $name", { name: jobName })
                queryClient.invalidateQueries({ queryKey: ["training-jobs"] })
                refetch()
              } catch {}
            }}>Stop</Button>
          )}
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Button size="sm" rounded="full" colorPalette="red" disabled={removing}>Remove Job</Button>
            </Dialog.Trigger>
            <Portal>
              <Dialog.Backdrop />
              <Dialog.Positioner>
                <Dialog.Content>
                  <Dialog.Header>
                    <Dialog.Title>Remove Training Job</Dialog.Title>
                  </Dialog.Header>
                  <Dialog.Body>
                    <Text>ジョブ「{jobName}」を削除します。よろしいですか？</Text>
                  </Dialog.Body>
                  <Dialog.Footer>
                    <Dialog.ActionTrigger asChild>
                      <Button variant="outline">Cancel</Button>
                    </Dialog.ActionTrigger>
                    <Button colorPalette="red" onClick={handleRemove} disabled={removing}>Remove</Button>
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

      <HStack align="flex-start" gap="16px" mt="16px">
        <Box w={{ base: "100%", md: "40%" }} rounded="md" borderWidth="1px" bg="bg.panel" p="16px">
          {isPending ? (
            <>
              <SkeletonText noOfLines={1} w="30%" />
              <Skeleton mt="2" h="14px" w="40%" />
              <Skeleton mt="2" h="14px" w="50%" />
            </>
          ) : isError ? (
            <HStack color="red.500" justify="space-between">
              <Box>Failed to load job: {String((error as any)?.message ?? error)}</Box>
              <Button size="xs" variant="outline" onClick={() => refetch()}>Retry</Button>
            </HStack>
          ) : !job ? (
            <Text color="gray.500">Job not found</Text>
          ) : (
            <VStack align="stretch" gap="8px">
              <HStack justify="space-between">
                <HStack gap="3">
                  <Heading size="lg">{job.name}</Heading>
                  <Badge colorPalette={job.status === 'ProcessWaiting' ? 'green' : job.status === 'StopInterrept' ? 'red' : 'gray'}>{job.status || 'Idle'}</Badge>
                </HStack>
              </HStack>
              <Text textStyle="sm" color="gray.700">Task: {job.taskType || '-'}</Text>
              <Text textStyle="sm" color="gray.700">Model: {job.model || '-'}</Text>
              <Text textStyle="sm" color="gray.700">Train/Test: {job.splitTrain ?? '-'} : {job.splitTest ?? '-'}</Text>
              <Text textStyle="sm" color="gray.700">Epochs: {job.epochs ?? '-'}</Text>
              <Text textStyle="sm" color="gray.700">Batch Size: {job.batchSize ?? '-'}</Text>
              <Box>
                <Text textStyle="sm" color="gray.700" fontWeight="bold">Datasets</Text>
                {(!job.datasets || job.datasets.length === 0) ? (
                  <Text textStyle="sm" color="gray.500">(none)</Text>
                ) : (
                  <VStack align="start" gap="1" mt="1">
                    {job.datasets.map((d) => (
                      <Text key={d} textStyle="sm">• {d}</Text>
                    ))}
                  </VStack>
                )}
              </Box>
              {job.labels && (
                <Box>
                  <Text textStyle="sm" color="gray.700" fontWeight="bold">Labels</Text>
                  {job.labels.length === 0 ? (
                    <Text textStyle="sm" color="gray.500">(none)</Text>
                  ) : (
                    <VStack align="start" gap="1" mt="1">
                      {job.labels.map((l) => (
                        <Text key={l} textStyle="sm">• {l}</Text>
                      ))}
                    </VStack>
                  )}
                </Box>
              )}
              <Text textStyle="xs" color="gray.500">Updated: {formatTimestamp(job.updatedAt) || '-'}</Text>
              <Text textStyle="xs" color="gray.500">Created: {formatTimestamp(job.createdAt) || '-'}</Text>
            </VStack>
          )}
        </Box>

        <VStack flex="1" align="stretch" gap="16px">
          <Box rounded="md" borderWidth="1px" bg="white" p="12px" w="100%">
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
    </Box>
  )
}

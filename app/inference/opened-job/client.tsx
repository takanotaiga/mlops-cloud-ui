"use client"

import { Box, Heading, HStack, VStack, Text, Button, Badge, Link, SkeletonText, Skeleton, Dialog, Portal, CloseButton, Progress, ButtonGroup, IconButton, Pagination } from "@chakra-ui/react"
import NextLink from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { decodeBase64Utf8 } from "@/components/utils/base64"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { extractRows } from "@/components/surreal/normalize"
import { useRouter } from "next/navigation"
import { useI18n } from "@/components/i18n/LanguageProvider"
import { getSignedObjectUrl } from "@/components/utils/minio"
import { LuChevronLeft, LuChevronRight } from "react-icons/lu"

type JobRow = {
  id: string
  name: string
  status?: string
  taskType?: string
  model?: string
  datasets?: string[]
  createdAt?: string
  updatedAt?: string
}

type InferenceResultRow = {
  id: string
  bucket: string
  key: string
  size?: number
  createdAt?: string
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

export default function ClientOpenedInferenceJobPage() {
  const { t } = useI18n()
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
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<boolean>(false)
  const [downloadPct, setDownloadPct] = useState<number>(0)
  const [checkingLocal, setCheckingLocal] = useState<boolean>(false)

  const { data: job, isPending, isError, error, refetch } = useQuery({
    queryKey: ["inference-job-detail", jobName],
    enabled: isSuccess && !!jobName,
    queryFn: async (): Promise<JobRow | null> => {
      const res = await surreal.query("SELECT * FROM inference_job WHERE name == $name ORDER BY updatedAt DESC LIMIT 1", { name: jobName })
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
        createdAt: r?.createdAt,
        updatedAt: r?.updatedAt,
      }
    },
    refetchOnWindowFocus: false,
    staleTime: 2000,
  })

  // Query inference results for this job when completed and task matches (newest first)
  const { data: results = [] } = useQuery({
    queryKey: ["inference-result", job?.id],
    enabled: isSuccess && !!job?.id && (job?.status === 'Complete' || job?.status === 'Completed') && job?.taskType === 'one-shot-object-detection',
    queryFn: async (): Promise<InferenceResultRow[]> => {
      if (!job?.id) return []
      const res = await surreal.query("SELECT * FROM inference_result WHERE job == <record> $job ORDER BY createdAt DESC", { job: job.id })
      const rows = extractRows<any>(res)
      return rows.map((r: any) => ({
        id: thingToString(r?.id),
        bucket: String(r?.bucket),
        key: String(r?.key),
        size: Number(r?.size ?? 0),
        createdAt: r?.createdAt,
      })) as InferenceResultRow[]
    },
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  })

  // Pagination state: 1-based page index
  const [page, setPage] = useState<number>(1)
  useEffect(() => { setPage(1); setVideoUrl(null) }, [results.length])
  const current = useMemo(() => (results && results.length > 0 ? results[Math.min(results.length, Math.max(1, page)) - 1] : undefined), [results, page])

  // OPFS helpers
  async function getOpfsRoot(): Promise<any> {
    const ns: any = (navigator as any).storage
    if (!ns?.getDirectory) throw new Error('OPFS not supported')
    return await ns.getDirectory()
  }
  async function ensurePath(root: any, path: string, create: boolean): Promise<{ dir: any; name: string }> {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop() || ''
    let dir = root
    for (const p of parts) {
      dir = await dir.getDirectoryHandle(p, { create })
    }
    return { dir, name }
  }
  async function opfsFileExists(path: string): Promise<boolean> {
    try {
      const root = await getOpfsRoot()
      const { dir, name } = await ensurePath(root, path, false)
      await dir.getFileHandle(name, { create: false })
      return true
    } catch { return false }
  }
  async function getOpfsFileUrl(path: string): Promise<string> {
    const root = await getOpfsRoot()
    const { dir, name } = await ensurePath(root, path, false)
    const fh = await dir.getFileHandle(name, { create: false })
    const file = await fh.getFile()
    return URL.createObjectURL(file)
  }
  async function downloadToOpfsWithProgress(bucket: string, key: string, expectedSize?: number) {
    setDownloading(true)
    setDownloadPct(0)
    try {
      const url = await getSignedObjectUrl(bucket, key, 60 * 30)
      const resp = await fetch(url)
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)
      const total = expectedSize && expectedSize > 0 ? expectedSize : Number(resp.headers.get('Content-Length') || 0)
      const reader = resp.body.getReader()
      const root = await getOpfsRoot()
      const { dir, name } = await ensurePath(root, key, true)
      const fh = await dir.getFileHandle(name, { create: true })
      const writable = await (fh as any).createWritable()
      let downloaded = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          await writable.write(value)
          downloaded += value.length || value.byteLength || 0
          if (total > 0) setDownloadPct(Math.min(100, Math.round((downloaded / total) * 100)))
        }
      }
      await writable.close()
      const fileUrl = await getOpfsFileUrl(key)
      setVideoUrl((prev) => { if (prev && prev.startsWith('blob:')) { try { URL.revokeObjectURL(prev) } catch { } } return fileUrl })
      setDownloadPct(100)
    } finally {
      setDownloading(false)
    }
  }

  // On page/result change, if exists in OPFS already, open it immediately and hide download button
  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!current?.key || !(job && (job.status === 'Complete' || job.status === 'Completed') && job.taskType === 'one-shot-object-detection')) return
      setCheckingLocal(true)
      try {
        const exists = await opfsFileExists(current.key)
        if (exists) {
          const url = await getOpfsFileUrl(current.key)
          if (!cancelled) setVideoUrl((prev) => { if (prev && prev.startsWith('blob:')) { try { URL.revokeObjectURL(prev) } catch { } } return url })
        } else {
          if (!cancelled) setVideoUrl(null)
        }
      } catch {
        if (!cancelled) setVideoUrl(null)
      } finally {
        if (!cancelled) setCheckingLocal(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [current?.key, job?.status, job?.taskType])

  function formatTimestamp(ts?: string): string {
    if (!ts) return ""
    const d = new Date(ts)
    if (isNaN(d.getTime())) return String(ts)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  async function handleRemove() {
    if (!jobName || removing) return
    setRemoving(true)
    try {
      await surreal.query("DELETE inference_job WHERE name == $name", { name: jobName })
      // Invalidate job list and navigate with refresh token to force reload
      queryClient.invalidateQueries({ queryKey: ["inference-jobs"] })
      const r = Date.now().toString()
      router.push(`/inference?r=${encodeURIComponent(r)}`)
    } catch {
      // ignore
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Box px="10%" py="20px">
      <HStack align="center" justify="space-between">
        <HStack gap="3" align="center">
          <Heading size="2xl">
            <Link asChild color="black" _hover={{ textDecoration: "none", color: "black" }}>
              <NextLink href="/inference">{t('inference.detail.breadcrumb', 'Inference 🤖')}</NextLink>
            </Link>
            {" / "}
            {jobName || "(unknown)"}
          </Heading>
          <Badge rounded="full" variant="subtle" colorPalette="teal">{t('inference.badge', 'Inference')}</Badge>
        </HStack>
        <HStack>
          {job?.status === 'ProcessWaiting' && (
            <Button size="sm" rounded="full" variant="outline" onClick={async () => {
              if (!jobName) return
              try {
                await surreal.query("UPDATE inference_job SET status = 'StopInterrept', updatedAt = time::now() WHERE name == $name", { name: jobName })
                queryClient.invalidateQueries({ queryKey: ["inference-jobs"] })
                refetch()
              } catch { }
            }}>{t('common.stop', 'Stop')}</Button>
          )}
          {job && job.status !== 'ProcessWaiting' && (
            (job.status === 'StopInterrept' || job.status === 'Complete' || job.status === 'Completed' || job.status === 'Failed' || job.status === 'Faild' || job.status === 'Error')
          ) && (
              <Button size="sm" rounded="full" variant="outline" onClick={async () => {
                if (!jobName) return
                try {
                  await surreal.query("UPDATE inference_job SET status = 'ProcessWaiting', updatedAt = time::now() WHERE name == $name", { name: jobName })
                  queryClient.invalidateQueries({ queryKey: ["inference-jobs"] })
                  refetch()
                } catch { }
              }}>{t('common.rerun_job', 'Rerun job')}</Button>
            )}
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Button size="sm" rounded="full" colorPalette="red" disabled={removing}>{t('common.remove_job', 'Remove Job')}</Button>
            </Dialog.Trigger>
            <Portal>
              <Dialog.Backdrop />
              <Dialog.Positioner>
                <Dialog.Content>
                  <Dialog.Header>
                    <Dialog.Title>Remove Inference Job</Dialog.Title>
                  </Dialog.Header>
                  <Dialog.Body>
                    <Text>ジョブ「{jobName}」を削除します。よろしいですか？</Text>
                  </Dialog.Body>
                  <Dialog.Footer>
                    <Dialog.ActionTrigger asChild>
                      <Button variant="outline">{t('common.cancel', 'Cancel')}</Button>
                    </Dialog.ActionTrigger>
                    <Button colorPalette="red" onClick={handleRemove} disabled={removing}>{t('common.remove', 'Remove')}</Button>
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
                  <Badge
                    colorPalette={
                      job.status === 'ProcessWaiting'
                        ? 'green'
                        : (job.status === 'StopInterrept' || job.status === 'Failed' || job.status === 'Faild')
                          ? 'red'
                          : (job.status === 'Complete' || job.status === 'Completed')
                            ? 'blue'
                            : 'gray'
                    }
                  >
                    {job.status || 'Idle'}
                  </Badge>
                </HStack>
              </HStack>
              <Text textStyle="sm" color="gray.700">Task: {job.taskType || '-'}</Text>
              <Text textStyle="sm" color="gray.700">Model: {job.model || '-'}</Text>
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
              <Text textStyle="xs" color="gray.500">Created: {formatTimestamp(job.createdAt)}</Text>
              <Text textStyle="xs" color="gray.500">Updated: {formatTimestamp(job.updatedAt)}</Text>
            </VStack>
          )}
        </Box>

        <Box flex="1" rounded="md" borderWidth="1px" bg="bg.panel" p="16px" minH="240px">
          {job && (job.status === 'Complete' || job.status === 'Completed') && job.taskType === 'one-shot-object-detection' ? (
            <VStack align="stretch" gap={3}>
              {(!results || results.length === 0) ? (
                <Text color="gray.600">Result not ready yet.</Text>
              ) : (
                <>
                  {/* Pagination Controls */}
                  <Pagination.Root count={results.length} pageSize={1} page={page} onPageChange={(e: any) => setPage(e.page)}>
                    <ButtonGroup variant="ghost" size="sm">
                      <Pagination.PrevTrigger asChild>
                        <IconButton aria-label="Prev result">
                          <LuChevronLeft />
                        </IconButton>
                      </Pagination.PrevTrigger>

                      <Pagination.Items
                        render={(p: any) => (
                          <IconButton aria-label={`Go to result ${p.value}`} variant={{ base: "ghost", _selected: "outline" }}>
                            {p.value}
                          </IconButton>
                        )}
                      />

                      <Pagination.NextTrigger asChild>
                        <IconButton aria-label="Next result">
                          <LuChevronRight />
                        </IconButton>
                      </Pagination.NextTrigger>
                    </ButtonGroup>
                  </Pagination.Root>

                  {/* Current Result */}
                  {videoUrl ? (
                    <>
                      <Text textStyle="sm" color="gray.700">{current?.key.split('/').pop()} — {formatTimestamp(current?.createdAt)}</Text>
                      <video controls style={{ width: '100%', maxHeight: '70vh' }} src={videoUrl} />
                    </>
                  ) : (
                    <>
                      <Text textStyle="sm" color="gray.700">Result video: {current?.key.split('/').pop()} — {formatTimestamp(current?.createdAt)}</Text>
                      {checkingLocal ? (
                        <Text textStyle="sm" color="gray.600">Checking local cache...</Text>
                      ) : (
                        <HStack>
                          <Button size="sm" rounded="full" onClick={async () => {
                            if (!current) return
                            await downloadToOpfsWithProgress(current.bucket, current.key, current.size)
                          }} disabled={downloading}>
                            {downloading ? 'Downloading...' : 'Download and Open (local)'}
                          </Button>
                        </HStack>
                      )}
                      {downloading && (
                        <Box maxW="360px">
                          <Progress.Root value={downloadPct}>
                            <Progress.Track>
                              <Progress.Range />
                            </Progress.Track>
                          </Progress.Root>
                          <Text textStyle="xs" color="gray.600" mt={1}>{downloadPct}%</Text>
                        </Box>
                      )}
                    </>
                  )}
                </>
              )}
            </VStack>
          ) : (
            <Text color="gray.500">Inference charts / logs can appear here.</Text>
          )}
        </Box>
      </HStack>
    </Box>
  )
}

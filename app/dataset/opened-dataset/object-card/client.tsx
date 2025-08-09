"use client"

import {
  Box,
  Heading,
  HStack,
  Link,
  Text,
  VStack,
  Button,
  Skeleton,
  SkeletonText,
  Dialog,
  Portal,
  CloseButton,
  Input,
  Textarea,
} from "@chakra-ui/react"
import NextLink from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { decodeBase64Utf8, encodeBase64Utf8 } from "@/components/utils/base64"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { extractRows } from "@/components/surreal/normalize"
import { getObjectUrlPreferPresign, deleteObjectFromS3 } from "@/components/utils/minio"
import { useRouter } from "next/navigation"

type FileRow = {
  id: string
  bucket: string
  key: string
  name: string
  mime?: string
  size?: number
  dataset?: string
  thumbKey?: string
}

// Normalize SurrealDB Thing (record id) to string for safe rendering
type ThingLike = { tb: string; id: unknown }
function thingToString(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "object" && v !== null && "tb" in (v as any) && "id" in (v as any)) {
    const t = v as ThingLike
    const id = typeof t.id === "object" && t.id !== null
      ? ((t.id as any).toString?.() ?? JSON.stringify(t.id))
      : String(t.id)
    return `${t.tb}:${id}`
  }
  return String(v)
}

export default function ClientObjectCardPage() {
  const router = useRouter()
  const params = useSearchParams()
  const queryClient = useQueryClient()
  const { datasetName, objectName, fileId, fallbackBucket, fallbackKey } = useMemo(() => {
    const d = params.get("d") || ""
    const n = params.get("n") || ""
    const i = params.get("id") || ""
    const b = params.get("b") || ""
    const k = params.get("k") || ""
    let datasetName = ""
    let objectName = ""
    let fileId = ""
    let fallbackBucket = ""
    let fallbackKey = ""
    try { datasetName = d ? decodeBase64Utf8(d) : "" } catch { datasetName = "" }
    try { objectName = n ? decodeBase64Utf8(n) : "" } catch { objectName = "" }
    try { fileId = i ? decodeBase64Utf8(i) : "" } catch { fileId = "" }
    try { fallbackBucket = b ? decodeBase64Utf8(b) : "" } catch { fallbackBucket = "" }
    try { fallbackKey = k ? decodeBase64Utf8(k) : "" } catch { fallbackKey = "" }
    return { datasetName, objectName, fileId, fallbackBucket, fallbackKey }
  }, [params])

  const surreal = useSurrealClient()
  const { isSuccess } = useSurreal()

  const { data: file, isPending } = useQuery({
    queryKey: ["object-card", fileId],
    enabled: isSuccess && !!fileId,
    queryFn: async (): Promise<FileRow | null> => {
      if (!fileId) return null
      const res = await surreal.query("SELECT * FROM file WHERE id == <record> $id LIMIT 1;", { id: fileId })
      const rows = extractRows<any>(res)
      const raw = rows[0]
      if (!raw) return null
      const normalized: FileRow = {
        ...raw,
        id: thingToString(raw.id),
        dataset: thingToString(raw.dataset),
      }
      return normalized
    },
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  })

  // Media type helpers
  const isImageType = useMemo(() => {
    const m = (file?.mime || "").toLowerCase()
    if (m.startsWith("image/")) return true
    const n = (file?.name || fallbackKey || "").toLowerCase()
    return /\.(jpg|jpeg|png|webp|gif|avif)$/.test(n)
  }, [file?.mime, file?.name, fallbackKey])

  const isVideoType = useMemo(() => {
    const m = (file?.mime || "").toLowerCase()
    if (m.startsWith("video/")) return true
    const n = (file?.name || fallbackKey || "").toLowerCase()
    return /\.(mp4|mov|mkv|avi|webm)$/.test(n)
  }, [file?.mime, file?.name, fallbackKey])

  // Dataset-level labels
  type LabelRow = { id: string; dataset: string; name: string }
  const { data: labels = [], isPending: labelsPending } = useQuery({
    queryKey: ["dataset-labels", datasetName],
    enabled: isSuccess && !!datasetName,
    queryFn: async (): Promise<LabelRow[]> => {
      const res = await surreal.query("SELECT * FROM label WHERE dataset == $dataset ORDER BY name ASC", { dataset: datasetName })
      const rows = extractRows<any>(res)
      return rows.map((r: any) => ({ ...r, id: thingToString(r?.id) })) as LabelRow[]
    },
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  })

  // File-level annotations (bounding boxes)
  type AnnotationRow = { id: string; dataset: string; file: string; label?: string; x1: number; y1: number; x2: number; y2: number; category?: string }
  const activeFileId = file?.id || fileId
  const annotationCategory = isVideoType ? "sam2_key_bbox" : "image_bbox"
  const { data: annotations = [] } = useQuery({
    queryKey: ["file-annotations", activeFileId, annotationCategory],
    enabled: isSuccess && !!activeFileId,
    queryFn: async (): Promise<AnnotationRow[]> => {
      // Backward compatibility: for images also include legacy rows with no category
      const where = isVideoType
        ? "category = 'sam2_key_bbox'"
        : "(category = 'image_bbox' OR category = NONE)"
      const res = await surreal.query(
        `SELECT * FROM annotation WHERE file == <record> $fid AND ${where}`,
        { fid: activeFileId },
      )
      const rows = extractRows<any>(res)
      return rows.map((r: any) => ({
        ...r,
        id: thingToString(r?.id),
        file: thingToString(r?.file),
      })) as AnnotationRow[]
    },
    refetchOnWindowFocus: false,
    staleTime: 2_000,
  })

  // Fetch ordered list for navigation (Prev/Next)
  type NavRow = { id: string; name?: string; key: string; bucket: string }
  const { data: navList = [] } = useQuery({
    queryKey: ["dataset-files-nav", datasetName],
    enabled: isSuccess && !!datasetName,
    queryFn: async (): Promise<NavRow[]> => {
      const res = await surreal.query(
        "SELECT id, name, key, bucket FROM file WHERE dataset == $dataset ORDER BY name ASC",
        { dataset: datasetName }
      )
      const rows = extractRows<any>(res)
      const mapped = rows.map((r) => ({ ...r, id: thingToString(r.id) })) as NavRow[]
      // Ensure sort order matches dataset grid: case-insensitive, numeric-aware by name fallback to key
      mapped.sort((a, b) => {
        const an = (a.name || a.key || "").toString()
        const bn = (b.name || b.key || "").toString()
        return an.localeCompare(bn, undefined, { sensitivity: "base", numeric: true })
      })
      return mapped
    },
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  })

  const { prevItem, nextItem } = useMemo(() => {
    if (!navList || navList.length === 0) return { prevItem: undefined, nextItem: undefined }
    const fid = file?.id || fileId
    let idx = -1
    if (fid) {
      idx = navList.findIndex((r) => r.id === fid)
    }
    if (idx === -1) {
      const k = file?.key || fallbackKey
      if (k) idx = navList.findIndex((r) => r.key === k)
    }
    if (idx === -1) {
      const n = file?.name || objectName
      if (n) idx = navList.findIndex((r) => (r.name || r.key) === n)
    }
    const prevItem = idx > 0 ? navList[idx - 1] : undefined
    const nextItem = idx >= 0 && idx < navList.length - 1 ? navList[idx + 1] : undefined
    return { prevItem, nextItem }
  }, [navList, file?.id, file?.key, file?.name, fileId, fallbackKey, objectName])

  function makeHref(item: NavRow | undefined): string | null {
    if (!item) return null
    const dEnc = encodeBase64Utf8(datasetName)
    const idEnc = encodeBase64Utf8(item.id)
    const nEnc = encodeBase64Utf8(item.name || item.key)
    const bEnc = encodeBase64Utf8(item.bucket)
    const kEnc = encodeBase64Utf8(item.key)
    return `/dataset/opened-dataset/object-card?d=${dEnc}&id=${idEnc}&n=${nEnc}&b=${bEnc}&k=${kEnc}`
  }

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewSize, setPreviewSize] = useState<number | undefined>(undefined)
  const [removing, setRemoving] = useState(false)
  const [activeLabel, setActiveLabel] = useState<string>("")
  const [newLabelName, setNewLabelName] = useState<string>("")
  const [textLabel, setTextLabel] = useState<string>("")
  const [textLabelId, setTextLabelId] = useState<string | null>(null)
  const [textSaving, setTextSaving] = useState<boolean>(false)

  // Helpers to mutate labels
  async function addLabel(name: string) {
    const trimmed = name.trim()
    if (!datasetName || !trimmed) return
    // Upsert-like behavior: check existence by dataset+name
    const exists = labels.some((l) => l.name === trimmed)
    if (exists) return
    await surreal.query("CREATE label CONTENT { dataset: $dataset, name: $name }", { dataset: datasetName, name: trimmed })
    await queryClient.invalidateQueries({ queryKey: ["dataset-labels", datasetName] })
    setActiveLabel(trimmed)
  }

  async function removeLabel(name: string) {
    if (!datasetName || !name) return
    // Remove label and any annotations referencing it in this dataset
    await surreal.query("DELETE label WHERE dataset == $dataset AND name == $name", { dataset: datasetName, name })
    await surreal.query("DELETE annotation WHERE dataset == $dataset AND label == $name", { dataset: datasetName, name })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dataset-labels", datasetName] }),
      queryClient.invalidateQueries({ queryKey: ["file-annotations", activeFileId] }),
    ])
    if (activeLabel === name) setActiveLabel("")
  }

  // Annotation mutations
  async function addBoxAnnotation(box: { x1: number; y1: number; x2: number; y2: number }) {
    if (!datasetName || !activeFileId) return
    const payload = {
      dataset: datasetName,
      file: activeFileId,
      label: activeLabel || undefined,
      category: annotationCategory,
      ...box,
    }
    await surreal.query(
      "CREATE annotation CONTENT { dataset: $dataset, file: <record> $file, label: $label, category: $category, x1: $x1, y1: $y1, x2: $x2, y2: $y2 }",
      payload as any,
    )
    await queryClient.invalidateQueries({ queryKey: ["file-annotations", activeFileId, annotationCategory] })
  }

  async function deleteAnnotation(id: string) {
    if (!id) return
    await surreal.query("DELETE annotation WHERE id = <record> $id", { id })
    await queryClient.invalidateQueries({ queryKey: ["file-annotations", activeFileId, annotationCategory] })
  }

  // Text Label: load existing per-file text label
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!activeFileId || !isSuccess) return
      try {
        const res = await surreal.query(
          "SELECT * FROM annotation WHERE file == <record> $fid AND category = 'text_label' LIMIT 1",
          { fid: activeFileId },
        )
        if (cancelled) return
        const rows = extractRows<any>(res)
        const row = rows?.[0]
        if (row) {
          setTextLabelId(thingToString(row.id))
          setTextLabel(String(row.text ?? ""))
        } else {
          setTextLabelId(null)
          setTextLabel("")
        }
      } catch { /* ignore */ }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileId, isSuccess])

  // Save text label helper
  async function saveTextLabel(next: string) {
    if (!activeFileId || !datasetName) return
    const content = next
    const trimmed = content.trim()
    setTextSaving(true)
    try {
      if (!trimmed) {
        if (textLabelId) {
          await surreal.query("DELETE annotation WHERE id = <record> $id", { id: textLabelId })
          setTextLabelId(null)
        }
      } else if (textLabelId) {
        await surreal.query("UPDATE annotation SET text = $text WHERE id = <record> $id", { id: textLabelId, text: content })
      } else {
        const res = await surreal.query(
          "CREATE annotation CONTENT { dataset: $dataset, file: <record> $file, category: 'text_label', text: $text }",
          { dataset: datasetName, file: activeFileId, text: content },
        )
        const rows = extractRows<any>(res)
        const created = rows?.[0]
        if (created?.id) setTextLabelId(thingToString(created.id))
      }
    } finally {
      setTextSaving(false)
    }
  }

  // Helper to add timeout to a promise
  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout")), ms)
      p.then((v) => { clearTimeout(t); resolve(v) }).catch((e) => { clearTimeout(t); reject(e) })
    })
  }

  async function handleRemove() {
    if (removing) return
    setRemoving(true)
    try {
      await withTimeout((async () => {
        // 1) Delete from SurrealDB
        if (file?.id) {
          await surreal.query("DELETE file WHERE id = <record> $id", { id: file.id })
        } else if (datasetName && (file?.key || fallbackKey)) {
          await surreal.query("DELETE file WHERE dataset = $dataset AND key = $key", { dataset: datasetName, key: file?.key || fallbackKey })
        }

        // 2) Delete from MinIO (object and its thumbnail if present)
        const bucket = file?.bucket || fallbackBucket
        const key = file?.key || fallbackKey
        const thumbKey = file?.thumbKey
        if (bucket && key) {
          try { await deleteObjectFromS3(bucket, key) } catch { /* ignore S3 delete errors */ }
        }
        if (bucket && thumbKey) {
          try { await deleteObjectFromS3(bucket, thumbKey) } catch { /* ignore */ }
        }
      })(), 3000)

      // Invalidate dataset file list and navigate back with a refresh token
      const d = params.get("d") || ""
      if (datasetName) {
        queryClient.invalidateQueries({ queryKey: ["dataset-files", datasetName] })
      }
      const r = Date.now().toString()
      router.push(`/dataset/opened-dataset?d=${encodeURIComponent(d)}&r=${encodeURIComponent(r)}`)
    } catch (e) {
      // On timeout or failure, do not block the user. Navigate back and refresh silently.
      const d = params.get("d") || ""
      if (datasetName) {
        queryClient.invalidateQueries({ queryKey: ["dataset-files", datasetName] })
      }
      const r = Date.now().toString()
      router.push(`/dataset/opened-dataset?d=${encodeURIComponent(d)}&r=${encodeURIComponent(r)}`)
    } finally {
      setRemoving(false)
    }
  }
  useEffect(() => {
    let cancelled = false
    let createdBlob: string | null = null
    const run = async () => {
      const bucket = file?.bucket || fallbackBucket
      const isVideo = (file?.mime || '').startsWith('video/')
      // If video without thumbnail, do not attempt to preview the video itself
      if (isVideo && !file?.thumbKey) { setPreviewUrl(null); return }
      // If this is a video and we have a stored thumbnail key, prefer that for preview
      const key = (isVideo && file?.thumbKey)
        ? file?.thumbKey
        : (file?.key || fallbackKey)
      if (!bucket || !key) { setPreviewUrl(null); return }
      try {
        const { url, isBlob, sizeBytes } = await getObjectUrlPreferPresign(bucket, key)
        if (cancelled) return
        setPreviewUrl(url)
        setPreviewSize(sizeBytes)
        if (isBlob) createdBlob = url
      } catch {
        setPreviewUrl(null)
      }
    }
    run()
    return () => {
      cancelled = true
      if (createdBlob) { try { URL.revokeObjectURL(createdBlob) } catch { } }
    }
  }, [file?.bucket, file?.key, file?.thumbKey, file?.mime, fallbackBucket, fallbackKey])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = (target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return
      if (e.key === 'ArrowLeft' && prevItem) {
        e.preventDefault()
        const href = makeHref(prevItem)
        if (href) router.push(href)
      } else if (e.key === 'ArrowRight' && nextItem) {
        e.preventDefault()
        const href = makeHref(nextItem)
        if (href) router.push(href)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prevItem, nextItem, router])

  return (
    <Box px="10%" py="20px">
      <HStack align="center" justify="space-between">
        <Heading size="2xl">
          <Link
            asChild
            color="black"
            textDecoration="none"
            _hover={{ textDecoration: "none", color: "black" }}
            _focusVisible={{ outline: "none", boxShadow: "none" }}
            _active={{ outline: "none", boxShadow: "none" }}
          >
            <NextLink href="/dataset">Dataset</NextLink>
          </Link>
          {" / "}
          <Link
            asChild
            color="black"
            textDecoration="none"
            _hover={{ textDecoration: "none", color: "black" }}
            _focusVisible={{ outline: "none", boxShadow: "none" }}
            _active={{ outline: "none", boxShadow: "none" }}
          >
            <NextLink href={`/dataset/opened-dataset?d=${encodeURIComponent(params.get("d") || "")}`}>
              {datasetName || "(unknown)"}
            </NextLink>
          </Link>
          {" / "}
          {objectName || file?.name || "Object"}
        </Heading>
        <HStack gap={2}>
          <Button
            size="sm"
            variant="subtle"
            rounded="full"
            onClick={() => { const href = makeHref(prevItem); if (href) router.push(href) }}
            disabled={!prevItem}
          >
            Prev
          </Button>

          <Button
            size="sm"
            variant="subtle"
            rounded="full"
            onClick={() => { const href = makeHref(nextItem); if (href) router.push(href) }}
            disabled={!nextItem}
          >
            Next
          </Button>

          <Box w="10px" />
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Button variant="outline" colorPalette="red" size="sm" rounded="full" disabled={removing || (!file && !fallbackBucket)}>
                Remove
              </Button>
            </Dialog.Trigger>
            <Portal>
              <Dialog.Backdrop />
              <Dialog.Positioner>
                <Dialog.Content>
                  <Dialog.Header>
                    <Dialog.Title>Delete Object</Dialog.Title>
                  </Dialog.Header>
                  <Dialog.Body>
                    <Text>このオブジェクトを削除します。よろしいですか？</Text>
                    <Text mt={2} color="gray.600">メタデータ（DB）削除後、MinIOの実体も削除します。</Text>
                  </Dialog.Body>
                  <Dialog.Footer>
                    <Dialog.ActionTrigger asChild>
                      <Button variant="outline">Cancel</Button>
                    </Dialog.ActionTrigger>
                    <Button onClick={handleRemove} disabled={removing} colorPalette="red">
                      {removing ? "Removing..." : "Delete"}
                    </Button>
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

      <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "30% 1fr" }} gap={8} mt={8}>
        {/* Left: Info */}
        <VStack align="stretch" gap={4}>
          <Box>
            {isPending ? (
              <>
                <SkeletonText noOfLines={1} />
                <SkeletonText noOfLines={2} mt={3} />
              </>
            ) : (
              <>
                <Heading size="md">{file?.name || objectName || "Object"}</Heading>
                <Text color="gray.600" mt={2}>{describeType(file?.mime, file?.name || fallbackKey)}</Text>
              </>
            )}
          </Box>

          <Box borderTopWidth="1px" />

          <Box>
            {isPending ? (
              <SkeletonText noOfLines={6} />
            ) : (
              <VStack align="stretch" gap={2} fontSize="sm">
                <HStack justify="space-between"><Text color="gray.500">Dataset</Text><Text>{file?.dataset || datasetName || "-"}</Text></HStack>
                <HStack justify="space-between"><Text color="gray.500">Bucket</Text><Text>{file?.bucket || fallbackBucket || "-"}</Text></HStack>
                <HStack justify="space-between"><Text color="gray.500">Key</Text><Text style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{file?.key || fallbackKey || "-"}</Text></HStack>
                <HStack justify="space-between"><Text color="gray.500">Size</Text><Text>{formatBytes(file?.size ?? previewSize)}</Text></HStack>
                <HStack justify="space-between"><Text color="gray.500">ID</Text><Text style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{file?.id || fileId}</Text></HStack>
              </VStack>
            )}
          </Box>

          {/* Labels (dataset-shared) */}
          <Box borderTopWidth="1px" pt={3}>
            <Heading size="sm" mb={2}>BBox Labels</Heading>
            <HStack gap={2} wrap="wrap">
              {labelsPending ? (
                <SkeletonText noOfLines={2} />
              ) : labels.length === 0 ? (
                <Text color="gray.500">ラベルがありません。追加してください。</Text>
              ) : (
                labels.map((l) => (
                  <HStack
                    key={l.id}
                    gap={1}
                    px={2}
                    py={1}
                    borderWidth="1px"
                    rounded="md"
                    cursor="pointer"
                    onClick={() => setActiveLabel(l.name)}
                    bg={activeLabel === l.name ? "gray.100" : undefined}
                  >
                    <Text>{l.name}</Text>
                    <Button size="xs" variant="ghost" colorPalette="red" onClick={(e) => { e.stopPropagation(); removeLabel(l.name) }}>x</Button>
                  </HStack>
                ))
              )}
            </HStack>
            <HStack mt={2} gap={2}>
              <Input
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                placeholder="新しいラベル名"
                size="sm"
                flex={1}
                onKeyDown={(e) => { if (e.key === 'Enter') { addLabel(newLabelName); setNewLabelName("") } }}
              />
              <Button size="sm" onClick={() => { addLabel(newLabelName); setNewLabelName("") }}>Add</Button>
            </HStack>
            {activeLabel && (
              <Text mt={2} fontSize="sm" color="gray.600">現在のアノテーション用ラベル: {activeLabel}</Text>
            )}

            {/* Text Label */}
            <Heading size="sm" mt={4} mb={2}>Text Label</Heading>
            <Textarea
              placeholder="Comment..."
              value={textLabel}
              onChange={(e) => setTextLabel(e.target.value)}
              onBlur={() => { void saveTextLabel(textLabel) }}
              size="sm"
            />
            <Text fontSize="xs" color={textSaving ? "gray.700" : "gray.500"} mt={1}>
              {textSaving ? "Saving..." : "自動保存されます"}
            </Text>
          </Box>
        </VStack>

        {/* Right: Preview */}
        <Box>
          <Box bg="bg.subtle" rounded="md" overflow="hidden" borderWidth="1px" minH="220px">
            {isPending ? (
              <Skeleton height="360px" />
            ) : previewUrl ? (
              <ImageAnnotator
                src={previewUrl}
                canAnnotate={isImageType || isVideoType}
                boxes={annotations}
                onAddBox={async (b) => {
                  if (!activeLabel) return
                  await addBoxAnnotation(b)
                }}
                onRemoveBox={(id) => deleteAnnotation(id)}
                labelFor={(l?: string) => l || "(no label)"}
                getBoxColor={(l?: string) => (l ? stringToColor(l) : "#3182ce")}
                requireLabel
                hasActiveLabel={!!activeLabel}
                missingLabelText="ラベルを選択してください"
              />
            ) : (
              <Box p={6}>
                <Text color="gray.500">プレビューを表示できません。</Text>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

// Keyboard navigation with ArrowLeft / ArrowRight
// Install global handler to move between objects
// placed after component to keep effect isolated
// Note: this block relies on closures above, so it must remain within the module scope
// but outside the component return markup.

function describeType(mime?: string, nameOrKey?: string): string {
  const m = (mime || "").toLowerCase()
  if (m) return m
  const n = (nameOrKey || "").toLowerCase()
  if (n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") || n.endsWith(".webp") || n.endsWith(".gif") || n.endsWith(".avif")) return "image/*"
  if (n.endsWith(".mp4") || n.endsWith(".mov") || n.endsWith(".mkv") || n.endsWith(".avi") || n.endsWith(".webm")) return "video/*"
  if (n.endsWith(".pcd") || n.endsWith(".ply") || n.endsWith(".las") || n.endsWith(".laz") || n.endsWith(".bin")) return "pointcloud/*"
  if (n.endsWith(".bag") || n.endsWith(".mcap")) return "rosbag/*"
  return "Unknown"
}

function formatBytes(size?: number): string {
  if (typeof size !== "number" || !isFinite(size) || size < 0) return "-"
  const units = ["B", "KB", "MB", "GB", "TB"] as const
  let s = size
  let i = 0
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++ }
  return `${s.toFixed(1)} ${units[i]}`
}

// Deterministic color from string
function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  const r = (hash >> 0) & 0xff
  const g = (hash >> 8) & 0xff
  const b = (hash >> 16) & 0xff
  return `rgb(${r % 200}, ${g % 200}, ${b % 200})`
}

type AnnotBox = { id?: string; label?: string; x1: number; y1: number; x2: number; y2: number }

function ImageAnnotator(props: {
  src: string
  canAnnotate: boolean
  boxes: { id: string; label?: string; x1: number; y1: number; x2: number; y2: number }[]
  onAddBox: (b: { x1: number; y1: number; x2: number; y2: number }) => void | Promise<void>
  onRemoveBox: (id: string) => void | Promise<void>
  labelFor?: (label?: string) => string
  getBoxColor?: (label?: string) => string
  requireLabel?: boolean
  hasActiveLabel?: boolean
  missingLabelText?: string
}) {
  const { src, canAnnotate, boxes, onAddBox, onRemoveBox, labelFor, getBoxColor, requireLabel, hasActiveLabel, missingLabelText } = props
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  // track size if needed in future (e.g., natural dims)

  function normPoint(e: any) {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }
  }

  function onClick(e: any) {
    if (!canAnnotate) return
    const p = normPoint(e)
    if (!start) {
      setStart(p)
      setCursor(p)
    } else {
      const x1 = Math.min(start.x, p.x)
      const y1 = Math.min(start.y, p.y)
      const x2 = Math.max(start.x, p.x)
      const y2 = Math.max(start.y, p.y)
      setStart(null)
      setCursor(null)
      onAddBox({ x1, y1, x2, y2 })
    }
  }

  function toCss(b: AnnotBox) {
    const left = `${Math.min(b.x1, b.x2) * 100}%`
    const top = `${Math.min(b.y1, b.y2) * 100}%`
    const width = `${Math.abs(b.x2 - b.x1) * 100}%`
    const height = `${Math.abs(b.y2 - b.y1) * 100}%`
    return { left, top, width, height }
  }

  return (
    <Box
      position="relative"
      onClick={onClick}
      onMouseMove={(e) => { if (canAnnotate) setCursor(normPoint(e)) }}
      onMouseLeave={() => { setCursor(null) }}
      cursor={canAnnotate ? "crosshair" : "default"}
    >
      <img
        src={src}
        alt="preview"
        style={{ width: "100%", height: "auto", display: "block" }}
        onLoad={() => { /* no-op */ }}
      />
      {/* Crosshair lines: always show while hovering over image */}
      {canAnnotate && cursor && (
        <>
          <Box
            position="absolute"
            top={0}
            bottom={0}
            left={`${cursor.x * 100}%`}
            width="1px"
            bg={(requireLabel && !hasActiveLabel) ? "#E53E3E" : "#3182ce"}
            opacity={0.7}
            pointerEvents="none"
            transform="translateX(-0.5px)"
          />
          <Box
            position="absolute"
            left={0}
            right={0}
            top={`${cursor.y * 100}%`}
            height="1px"
            bg={(requireLabel && !hasActiveLabel) ? "#E53E3E" : "#3182ce"}
            opacity={0.7}
            pointerEvents="none"
            transform="translateY(-0.5px)"
          />
          {(requireLabel && !hasActiveLabel) && (
            <Box
              position="absolute"
              left={`calc(${cursor.x * 100}% + 8px)`}
              top={`calc(${cursor.y * 100}% + 8px)`}
              bg="#E53E3E"
              color="white"
              fontSize="xs"
              px={2}
              py={1}
              rounded="sm"
              pointerEvents="none"
              shadow="md"
            >
              {missingLabelText || "ラベル未選択"}
            </Box>
          )}
        </>
      )}
      {/* Existing boxes */}
      {boxes?.map((b) => {
        const color = getBoxColor?.(b.label) || "#3182ce"
        return (
          <Box
            key={b.id}
            position="absolute"
            border="2px solid"
            borderColor={color}
            bg="transparent"
            pointerEvents="auto"
            {...toCss(b)}
          >
            <Box position="absolute" top="-22px" left={0} bg={color} color="white" px={2} py={0.5} fontSize="xs" rounded="sm">
              {labelFor?.(b.label) || b.label || "box"}
            </Box>
            <Button
              size="xs"
              variant="solid"
              colorPalette="red"
              position="absolute"
              top={-22}
              right={0}
              onClick={(e) => { e.stopPropagation(); onRemoveBox(b.id) }}
            >
              x
            </Button>
          </Box>
        )
      })}
      {/* Provisional box while selecting second point */}
      {start && (
        <Box position="absolute" left={`${start.x * 100}%`} top={`${start.y * 100}%`} width="0" height="0">
          <Box width="8px" height="8px" bg="#3182ce" rounded="full" transform="translate(-50%, -50%)" />
        </Box>
      )}
      {canAnnotate ? (
        <Box position="absolute" bottom={2} left={2} bg="blackAlpha.600" color="white" px={2} py={1} fontSize="xs" rounded="sm">
          {start ? "2点目をクリックして四角形を確定" : "画像上を2回クリックして四角形を作成"}
        </Box>
      ) : null}
    </Box>
  )
}

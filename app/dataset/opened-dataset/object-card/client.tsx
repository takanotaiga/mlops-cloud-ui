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
      return rows.map((r) => ({ ...r, id: thingToString(r.id) })) as NavRow[]
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
          await surreal.query("DELETE file WHERE id = $id", { id: file.id })
        } else if (datasetName && (file?.key || fallbackKey)) {
          await surreal.query("DELETE file WHERE dataset = $dataset AND key = $key", { dataset: datasetName, key: file?.key || fallbackKey })
        }

        // 2) Delete from MinIO
        const bucket = file?.bucket || fallbackBucket
        const key = file?.key || fallbackKey
        if (bucket && key) {
          try { await deleteObjectFromS3(bucket, key) } catch { /* ignore S3 delete errors */ }
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
        </VStack>

        {/* Right: Preview */}
        <Box>
          <Box bg="bg.subtle" rounded="md" overflow="hidden" borderWidth="1px" minH="220px">
            {isPending ? (
              <Skeleton height="360px" />
            ) : previewUrl ? (
              <Box asChild>
                <img src={previewUrl} alt={file?.name || objectName || "object"} style={{ width: "100%", height: "auto", display: "block" }} />
              </Box>
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

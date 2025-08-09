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
import { decodeBase64Utf8 } from "@/components/utils/base64"
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
      const res = await surreal.query("SELECT * FROM file WHERE id == $id LIMIT 1", { id: fileId })
      const rows = extractRows<FileRow>(res)
      return rows[0] ?? null
    },
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  })

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
      const key = file?.key || fallbackKey
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
  }, [file?.bucket, file?.key, fallbackBucket, fallbackKey])

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
              (file?.mime || "").startsWith("video/") ? (
                <Box asChild>
                  <video src={previewUrl} controls style={{ width: "100%", maxHeight: "70vh", display: "block" }} />
                </Box>
              ) : (
                <Box asChild>
                  <img src={previewUrl} alt={file?.name || objectName || "object"} style={{ width: "100%", height: "auto", display: "block" }} />
                </Box>
              )
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

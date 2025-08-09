"use client"

import {
  Box,
  Flex,
  VStack,
  SimpleGrid,
  Heading,
  Button,
  CheckboxGroup,
  Checkbox,
  Fieldset,
  Text,
  HStack,
  For,
} from "@chakra-ui/react"
// import ContentCard from "@/components/content-card"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { decodeBase64Utf8 } from "@/components/utils/base64"
import NextLink from "next/link"
import { Link } from "@chakra-ui/react"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"
import { useQuery } from "@tanstack/react-query"
import { extractRows } from "@/components/surreal/normalize"
import { getObjectUrlPreferPresign } from "@/components/utils/minio"
import { Image } from "@chakra-ui/react"

export default function Page() {
  const params = useSearchParams()
  const datasetName = useMemo(() => {
    const d = params.get("d")
    if (!d) return ""
    try {
      return decodeBase64Utf8(d)
    } catch {
      return ""
    }
  }, [params])

  const surreal = useSurrealClient()
  const { isSuccess } = useSurreal()

  type FileRow = {
    bucket: string
    dataset: string
    encode?: string
    id: string
    key: string
    mime?: string
    name: string
    size?: number
    uploadedAt?: string
  }

  const { data: files = [], isPending, isError, error, refetch } = useQuery({
    queryKey: ["dataset-files", datasetName],
    enabled: isSuccess && !!datasetName,
    queryFn: async () => {
      const res = await surreal.query("SELECT * FROM file WHERE dataset == $dataset", { dataset: datasetName })
      const rows = extractRows<FileRow>(res)
      return rows
    },
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  })

  const [imgUrls, setImgUrls] = useState<Record<string, string>>({})

  // Media type filtering
  const MEDIA_OPTIONS = useMemo(() => ["Video", "Image", "PointCloud", "ROSBag"] as const, [])
  type MediaType = (typeof MEDIA_OPTIONS)[number]
  const [selectedMedia, setSelectedMedia] = useState<MediaType[]>([...MEDIA_OPTIONS])

  const classifyMedia = (f: FileRow): MediaType | "Other" => {
    const mime = (f.mime || "").toLowerCase()
    if (mime.startsWith("image/")) return "Image"
    if (mime.startsWith("video/")) return "Video"
    // Extension fallback
    const key = (f.name || f.key || "").toLowerCase()
    if (key.endsWith(".jpg") || key.endsWith(".jpeg") || key.endsWith(".png") || key.endsWith(".webp") || key.endsWith(".gif") || key.endsWith(".avif")) return "Image"
    if (key.endsWith(".mp4") || key.endsWith(".mov") || key.endsWith(".mkv") || key.endsWith(".avi") || key.endsWith(".webm")) return "Video"
    if (key.endsWith(".pcd") || key.endsWith(".ply") || key.endsWith(".las") || key.endsWith(".laz") || key.endsWith(".bin")) return "PointCloud"
    if (key.endsWith(".bag") || key.endsWith(".mcap")) return "ROSBag"
    return "Other"
  }

  const visibleFiles = useMemo(() => {
    if (!files || selectedMedia.length === 0) return []
    const set = new Set(selectedMedia)
    return files.filter((f) => set.has(classifyMedia(f) as MediaType))
  }, [files, selectedMedia])

  useEffect(() => {
    // If there are no files, clear and revoke any blob URLs we created earlier.
    if (!files || files.length === 0) {
      setImgUrls((prev) => {
        Object.values(prev).forEach((u) => { if (u.startsWith("blob:")) URL.revokeObjectURL(u) })
        return {}
      })
      return
    }

    let cancelled = false
    const createdBlobs: string[] = []
    const run = async () => {
      const next: Record<string, string> = {}
      for (const f of files) {
        if (f.mime && f.mime.startsWith("image/")) {
          try {
            const { url, isBlob } = await getObjectUrlPreferPresign(f.bucket, f.key)
            if (cancelled) return
            next[f.key] = url
            if (isBlob) createdBlobs.push(url)
          } catch {
            // ignore errors for individual objects
          }
        }
      }
      if (cancelled) return
      setImgUrls((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === next[k])) {
          return prev
        }
        return next
      })
    }
    run()
    return () => {
      cancelled = true
      createdBlobs.forEach((u) => { try { URL.revokeObjectURL(u) } catch { } })
    }
  }, [files])

  return (
    <Box px="10%" py="20px">
      <HStack align="center" justify="space-between">
        <Heading size="2xl" >
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
          {datasetName || "(unknown)"}
        </Heading>

        <Box mt={8} textAlign="right" pb="10px">
          <Button mr={4} size="sm" variant="outline" rounded="full">
            Export Dataset
          </Button>
          <Button variant="outline" colorPalette="red" size="sm" rounded="full" >
            Remove
          </Button>
        </Box>
      </HStack>

      <Flex align="flex-start">
        <VStack align="start" w="25%" gap="10px">
          <Fieldset.Root>
            <Fieldset.Legend>
              <Text fontWeight="bold">Label Type</Text>
            </Fieldset.Legend>
            <Fieldset.Content>
              <CheckboxGroup name="label" defaultValue={["Bounding Box"]}>
                <For each={["Bounding Box", "Segmentation", "Text"]}>
                  {(value) => (
                    <Checkbox.Root key={value} value={value}>
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                      <Checkbox.Label>{value}</Checkbox.Label>
                    </Checkbox.Root>
                  )}
                </For>
              </CheckboxGroup>
            </Fieldset.Content>
          </Fieldset.Root>

          <Fieldset.Root>
            <Fieldset.Legend>
              <Text fontWeight="bold">Media Type</Text>
            </Fieldset.Legend>
            <Fieldset.Content>
              <CheckboxGroup
                name="media"
                value={selectedMedia}
                onValueChange={(e: any) => {
                  const next = (e?.value ?? e) as string[]
                  // Coerce to MediaType[], filter out unknowns
                  setSelectedMedia(next.filter((v) => (MEDIA_OPTIONS as readonly string[]).includes(v)) as MediaType[])
                }}
              >
                <For each={MEDIA_OPTIONS as unknown as string[]}>
                  {(value) => (
                    <Checkbox.Root key={value} value={value}>
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                      <Checkbox.Label>{value}</Checkbox.Label>
                    </Checkbox.Root>
                  )}
                </For>
              </CheckboxGroup>
            </Fieldset.Content>
          </Fieldset.Root>
        </VStack>

        <Box flex="1" ml={8}>
          {isError && (
            <HStack color="red.500" justify="space-between" mb="2">
              <Box>Failed to load files: {String((error as any)?.message ?? error)}</Box>
              <Button size="xs" variant="outline" onClick={() => refetch()}>Retry</Button>
            </HStack>
          )}
          <SimpleGrid columns={[2, 3, 4]} gap="10px">
            {!isPending && visibleFiles.map((f) => {
              const isImage = (f.mime || "").startsWith("image/")
              const url = isImage ? imgUrls[f.key] : undefined
              return (
                <Box key={f.id} bg="white" width="200px" pb="8px" rounded="md" borderWidth="1px" overflow="hidden">
                  <Box bg="bg.subtle" style={{ aspectRatio: 1 as any }}>
                    {isImage && url ? (
                      <Image src={url} alt={f.name} objectFit="cover" w="100%" h="100%" />
                    ) : (
                      <Image
                        src="/static/sample.jpg"
                        alt={f.name}
                        objectFit="cover"
                        w="100%"
                        h="100%"
                      />
                    )}
                  </Box>
                  <Box px="8px" pt="6px">
                    <Text fontSize="sm" style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{f.name}</Text>
                  </Box>
                </Box>
              )
            })}
          </SimpleGrid>
        </Box>
      </Flex>
    </Box>
  )
}

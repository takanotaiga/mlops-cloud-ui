"use client"
import {
  Text,
  HStack,
  VStack,
  Heading,
  SimpleGrid,
  Button,
  Box,
  Input,
  InputGroup,
  Skeleton,
  SkeletonText,
  Badge,
} from "@chakra-ui/react"
import { LuSearch } from "react-icons/lu"
import NextLink from "next/link"
import { useI18n } from "@/components/i18n/LanguageProvider"
import { useDeferredValue, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"
import { extractRows } from "@/components/surreal/normalize"
import { encodeBase64Utf8 } from "@/components/utils/base64"

type FileRow = { dataset: string; uploadedAt?: string; mime?: string; name?: string; key: string }

function formatTimestamp(ts?: string): string {
  if (!ts) return ""
  const d = new Date(ts)
  if (isNaN(d.getTime())) return String(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type MediaType = "Image" | "Video" | "PointCloud" | "ROSBag" | "Other"
function classifyMediaByNameOrMime(mime?: string, nameOrKey?: string): MediaType {
  const m = (mime || "").toLowerCase()
  const n = (nameOrKey || "").toLowerCase()
  if (m.startsWith("image/")) return "Image"
  if (m.startsWith("video/")) return "Video"
  if (n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") || n.endsWith(".webp") || n.endsWith(".gif") || n.endsWith(".avif")) return "Image"
  if (n.endsWith(".mp4") || n.endsWith(".mov") || n.endsWith(".mkv") || n.endsWith(".avi") || n.endsWith(".webm")) return "Video"
  if (n.endsWith(".pcd") || n.endsWith(".ply") || n.endsWith(".las") || n.endsWith(".laz") || n.endsWith(".bin")) return "PointCloud"
  if (n.endsWith(".bag") || n.endsWith(".mcap")) return "ROSBag"
  return "Other"
}

export default function DatasetListPage() {
  const { t } = useI18n()
  const surreal = useSurrealClient()
  const { isSuccess } = useSurreal()
  const [query, setQuery] = useState<string>("")
  const deferredQuery = useDeferredValue(query)

  const { data: datasetStats = [], isPending, isError, error, refetch } = useQuery({
    queryKey: ["datasets"],
    enabled: isSuccess,
    queryFn: async (): Promise<{ name: string; count: number; createdAt?: string; media: MediaType[] }[]> => {
      const res = await surreal.query("SELECT dataset, uploadedAt, mime, name, key FROM file")
      const rows = extractRows<FileRow>(res)
      const map = new Map<string, { count: number; createdAt?: string; mediaSet: Set<MediaType> }>()
      for (const r of rows) {
        const ds = r.dataset || ""
        if (!ds) continue
        const entry = map.get(ds) || { count: 0, createdAt: undefined, mediaSet: new Set<MediaType>() }
        entry.count += 1
        if (r.uploadedAt) {
          if (!entry.createdAt || new Date(r.uploadedAt) < new Date(entry.createdAt)) entry.createdAt = r.uploadedAt
        }
        entry.mediaSet.add(classifyMediaByNameOrMime(r.mime, r.name || r.key))
        map.set(ds, entry)
      }
      const list = Array.from(map.entries()).map(([name, v]) => ({ name, count: v.count, createdAt: v.createdAt, media: Array.from(v.mediaSet).filter((m) => m !== 'Other') }))
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
      return list
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })

  const filtered = useMemo(() => {
    const names = datasetStats ?? []
    const q = deferredQuery.trim().toLowerCase()
    if (!q) return names
    return names.filter((d) => d.name.toLowerCase().includes(q))
  }, [datasetStats, deferredQuery])

  return (
    <HStack justify="center">
      <VStack w="70%" align="stretch" py="24px" gap="16px">
        <HStack justify="space-between" pb="8px">
          <HStack gap="3" align="center">
            <Heading size="2xl">{t('datasets.title','Datasets 📚')}</Heading>
            <Badge rounded="full" variant="subtle" colorPalette="purple">{t('nav.datasets','Datasets')}</Badge>
          </HStack>
          <NextLink href="/dataset/upload" passHref>
            <Button rounded="full">Upload</Button>
          </NextLink>
        </HStack>
        <Text textStyle="sm" color="gray.600">{t('datasets.subtitle')}</Text>
        <InputGroup
          flex="1"
          startElement={<LuSearch />}
          endElement={
            query ? (
              <Button size="xs" variant="ghost" onClick={() => setQuery("")}>{t('common.clear','Clear')}</Button>
            ) : undefined
          }
        >
          <Input
            placeholder={t('datasets.search.placeholder','Search datasets')}
            size="sm"
            variant="flushed"
            aria-label="Search datasets by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        {isError && (
          <HStack color="red.500" justify="space-between">
            <Box>Failed to load datasets: {String((error as any)?.message ?? error)}</Box>
            <Button size="xs" variant="outline" onClick={() => refetch()}>{t('common.retry','Retry')}</Button>
          </HStack>
        )}
        <SimpleGrid columns={[1, 2, 3]} gap="16px">
          {isPending ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Box key={i} rounded="md" borderWidth="1px" bg="white" p="12px">
                <SkeletonText noOfLines={1} w="60%" />
                <Skeleton mt="3" h="14px" w="40%" />
                <Skeleton mt="2" h="14px" w="50%" />
              </Box>
            ))
          ) : filtered.length === 0 ? (
            <Text color="gray.500">{t('datasets.empty','No datasets found')}</Text>
          ) : (
            filtered.map((d) => (
              <NextLink key={d.name} href={`/dataset/opened-dataset?d=${encodeBase64Utf8(d.name)}`}>
                <Box rounded="md" borderWidth="1px" bg="white" p="12px" _hover={{ shadow: "md" }}>
                  <HStack justify="space-between" mb="1">
                    <Heading size="md">{d.name}</Heading>
                    <HStack gap="1">
                      {d.media.map((m) => (
                        <Badge key={m} variant="subtle" colorPalette={m === 'Image' ? 'purple' : m === 'Video' ? 'teal' : m === 'PointCloud' ? 'blue' : 'gray'}>{m}</Badge>
                      ))}
                    </HStack>
                  </HStack>
                  <Text textStyle="sm" color="gray.600">{d.count.toLocaleString()} items</Text>
                  {d.createdAt && (
                    <Text mt="1" textStyle="xs" color="gray.500">Created: {formatTimestamp(d.createdAt)}</Text>
                  )}
                </Box>
              </NextLink>
            ))
          )}
        </SimpleGrid>
      </VStack>
    </HStack>
  )
}


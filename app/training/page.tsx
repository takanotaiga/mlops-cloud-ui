"use client"

import { Box, HStack, VStack, Heading, Text, Button, Input, InputGroup, SimpleGrid, Badge, Skeleton, SkeletonText } from "@chakra-ui/react"
import { useDeferredValue, useMemo, useState } from "react"
import NextLink from "next/link"
import { LuSearch } from "react-icons/lu"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"
import { useQuery } from "@tanstack/react-query"
import { extractRows } from "@/components/surreal/normalize"
import { encodeBase64Utf8 } from "@/components/utils/base64"
import { useSearchParams } from "next/navigation"

type JobRow = {
  id: string
  name: string
  status?: string
  taskType?: string
  model?: string
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

function formatTimestamp(ts?: string): string {
  if (!ts) return ""
  const d = new Date(ts)
  if (isNaN(d.getTime())) return String(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Page() {
  const surreal = useSurrealClient()
  const { isSuccess } = useSurreal()
  const [query, setQuery] = useState("")
  const deferred = useDeferredValue(query)
  const params = useSearchParams()
  const refresh = params.get("r") || ""
  const { data: jobs = [], isPending, isError, error, refetch } = useQuery({
    queryKey: ["training-jobs", refresh],
    enabled: isSuccess,
    queryFn: async (): Promise<JobRow[]> => {
      const res = await surreal.query("SELECT * FROM training_job ORDER BY updatedAt DESC")
      const rows = extractRows<any>(res)
      return rows.map((r: any) => ({
        id: thingToString(r?.id),
        name: String(r?.name ?? ""),
        status: r?.status,
        taskType: r?.taskType,
        model: r?.model,
        updatedAt: r?.updatedAt,
      }))
    },
    staleTime: 5000,
    refetchOnWindowFocus: false,
  })

  const filtered = useMemo(() => {
    const q = deferred.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter((j) => j.name?.toLowerCase().includes(q) || j.model?.toLowerCase().includes(q) || j.taskType?.toLowerCase().includes(q))
  }, [jobs, deferred])

  return (
    <HStack justify="center">
      <VStack w="70%" align="stretch" py="24px" gap="16px">
        <HStack justify="space-between" pb="8px">
          <Heading size="2xl">Training Jobs</Heading>
          <NextLink href="/training/create" passHref>
            <Button rounded="full">Create new</Button>
          </NextLink>
        </HStack>
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
            placeholder="Search jobs by name, model, task"
            size="sm"
            variant="flushed"
            aria-label="Search jobs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>

        {isError && (
          <HStack color="red.500" justify="space-between">
            <Box>Failed to load jobs: {String((error as any)?.message ?? error)}</Box>
            <Button size="xs" variant="outline" onClick={() => refetch()}>Retry</Button>
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
            <Text color="gray.500">No jobs found</Text>
          ) : (
            filtered.map((j) => (
              <NextLink key={j.id} href={`/training/opened-job?j=${encodeBase64Utf8(j.name)}`}>
                <Box rounded="md" borderWidth="1px" bg="white" p="12px" _hover={{ shadow: "md" }}>
                  <HStack justify="space-between" mb="1">
                    <Heading size="md">{j.name || "(no name)"}</Heading>
                    <Badge colorPalette={j.status === 'ProcessWaiting' ? 'green' : j.status === 'StopInterrept' ? 'red' : 'gray'}>{j.status || 'Idle'}</Badge>
                  </HStack>
                  <Text textStyle="sm" color="gray.600">{j.taskType || "-"} • {j.model || "-"}</Text>
                  {j.updatedAt && (
                    <Text mt="1" textStyle="xs" color="gray.500">Updated: {formatTimestamp(j.updatedAt)}</Text>
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

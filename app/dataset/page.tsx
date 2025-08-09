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
  Spacer,
} from "@chakra-ui/react"

import ImageCard from "@/components/image-card"
import { BsPlusCircleFill } from "react-icons/bs";
import { LuSearch } from "react-icons/lu"

import NextLink from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"

export default function Page() {
  const surreal = useSurrealClient()
  const { isSuccess } = useSurreal()
  const [datasets, setDatasets] = useState<string[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState<string>("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return datasets
    return datasets.filter((name) => name.toLowerCase().includes(q))
  }, [datasets, query])

  useEffect(() => {
    if (!isSuccess) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const res: any = await surreal.query("SELECT dataset FROM file GROUP BY dataset;")
        // Handle both shapes: [{ result: [...] }] and [[ ... ]]
        let rows: any[] = []
        if (Array.isArray(res)) {
          if (Array.isArray(res[0])) {
            rows = res[0]
          } else if (Array.isArray((res as any)[0]?.result)) {
            rows = (res as any)[0].result
          } else {
            rows = (res as any[]).flatMap((r: any) => (Array.isArray(r?.result) ? r.result : Array.isArray(r) ? r : []))
          }
        }
        const names = rows
          .map((r: any) => (typeof r?.dataset === "string" ? r.dataset : null))
          .filter((v: any): v is string => !!v)
        if (!cancelled) setDatasets(Array.from(new Set(names)))
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load datasets")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [surreal, isSuccess])

  return (
    <HStack justify="center">
      <VStack w="70%" >
        <HStack w="95%" justify="space-between" pb="40px" pt="30px">
          <Box alignSelf="flex-start" ml="30px">
            <HStack alignSelf="flex-start">
              <Heading size="2xl" >Datasets</Heading>
              <NextLink href="/dataset/upload" passHref>
                <Button variant="plain" rounded="full" w="10px" >
                  <BsPlusCircleFill color="#8E8E93" />
                </Button>
              </NextLink>
            </HStack>
            <Text textAlign="left" w="100%" fontWeight="normal" textStyle="sm" color="gray.500">This is the text component</Text>
          </Box>
          <Box alignSelf="flex-start" ml="30px">
            <Spacer h="10px" />
            <InputGroup flex="1" startElement={<LuSearch />} >
              <Input
                placeholder="Search datasets"
                size="sm"
                variant="flushed"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
          </Box>
        </HStack>
        {error && (
          <Box w="95%" ml="30px" color="red.500">{error}</Box>
        )}
        <SimpleGrid columns={[2, 3, 4]} gap="30px" mx="auto">
          {!loading && filtered.map((name) => <ImageCard key={name} title={name} />)}
        </SimpleGrid>
        {!loading && filtered.length === 0 && (
          <Box w="95%" ml="30px" color="gray.500" py="10px">No datasets found</Box>
        )}
      </VStack>
    </HStack>
  )
}

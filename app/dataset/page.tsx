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
import { useDeferredValue, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"
import { extractDatasetNames } from "@/components/surreal/normalize"

export default function Page() {
  const surreal = useSurrealClient()
  const { isSuccess } = useSurreal()
  const [query, setQuery] = useState<string>("")
  const deferredQuery = useDeferredValue(query)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["datasets"],
    enabled: isSuccess,
    queryFn: async () => {
      const res = await surreal.query("SELECT dataset FROM file GROUP BY dataset;")
      return extractDatasetNames(res)
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })

  const filtered = useMemo(() => {
    const names = data ?? []
    const q = deferredQuery.trim().toLowerCase()
    if (!q) return names
    return names.filter((name) => name.toLowerCase().includes(q))
  }, [data, deferredQuery])

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
                placeholder="Search datasets"
                size="sm"
                variant="flushed"
                aria-label="Search datasets by name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
          </Box>
        </HStack>
        {isError && (
          <HStack w="95%" ml="30px" color="red.500" justify="space-between">
            <Box>Failed to load datasets: {String((error as any)?.message ?? error)}</Box>
            <Button size="xs" variant="outline" onClick={() => refetch()}>Retry</Button>
          </HStack>
        )}
        <SimpleGrid columns={[2, 3, 4]} gap="30px" mx="auto">
          {!isPending && filtered.map((name) => <ImageCard key={name} title={name} />)}
        </SimpleGrid>
        {!isPending && filtered.length === 0 && (
          <Box w="95%" ml="30px" color="gray.500" py="10px">No datasets found</Box>
        )}
      </VStack>
    </HStack>
  )
}

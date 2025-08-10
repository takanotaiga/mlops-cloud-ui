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
  Skeleton,
  SkeletonText,
  Badge,
} from "@chakra-ui/react"

import ImageCard from "@/components/image-card"
import { BsPlusCircleFill } from "react-icons/bs";
import { LuSearch } from "react-icons/lu"

import NextLink from "next/link"
import { useI18n } from "@/components/i18n/LanguageProvider"
import { useDeferredValue, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider"
import { extractDatasetNames } from "@/components/surreal/normalize"
import { encodeBase64Utf8 } from "@/components/utils/base64"

export default function Page() {
  const { t } = useI18n()
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
              <Heading size="2xl">{t('datasets.title','Datasets 📚')}</Heading>
              <Badge rounded="full" variant="subtle" colorPalette="purple">{t('nav.datasets','Datasets')}</Badge>
              <NextLink href="/dataset/upload" passHref>
                <Button variant="plain" rounded="full" w="10px" aria-label="Upload dataset">
                  <BsPlusCircleFill color="#8E8E93" />
                </Button>
              </NextLink>
            </HStack>
            <Text textAlign="left" w="100%" fontWeight="normal" textStyle="sm" color="gray.600">{t('datasets.subtitle')}</Text>
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
                placeholder={t('datasets.search.placeholder','Search datasets')}
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
          {isPending
            ? Array.from({ length: 4 }).map((_, i) => (
                <Box key={i} px="10px">
                  <Box bg="white" width="200px" pb="40px">
                    <VStack>
                      <Skeleton rounded="md" h="200px" w="200px" />
                      <SkeletonText noOfLines={1} w="95%" mt="4" />
                      <SkeletonText noOfLines={1} w="80%" />
                    </VStack>
                  </Box>
                </Box>
              ))
            : filtered.map((name) => (
                <ImageCard
                  key={name}
                  title={name}
                  href={`/dataset/opened-dataset?d=${encodeBase64Utf8(name)}`}
                />
              ))}
        </SimpleGrid>
        {!isPending && filtered.length === 0 && (
          <Box w="95%" ml="30px" color="gray.500" py="10px">{t('datasets.empty','No datasets found')}</Box>
        )}
      </VStack>
    </HStack>
  )
}

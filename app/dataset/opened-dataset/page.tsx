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
import ContentCard from "@/components/content-card"
import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { decodeBase64Utf8 } from "@/components/utils/base64"
import NextLink from "next/link"
import { Link } from "@chakra-ui/react"

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

        <Box mt={8} textAlign="right">
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
              <CheckboxGroup name="media" defaultValue={["Image"]}>
                <For each={["Video", "Image", "PointCloud", "ROSBag"]}>
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
          <SimpleGrid columns={[2, 3, 4]} gap="10px">
            {Array.from({ length: 11 }).map((_, i) => (
              <ContentCard key={i} />
            ))}
          </SimpleGrid>
        </Box>
      </Flex>
    </Box>
  )
}

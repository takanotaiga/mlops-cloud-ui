"use client"

import { Box, Heading, HStack, Link, Text } from "@chakra-ui/react"
import NextLink from "next/link"
import { useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { decodeBase64Utf8 } from "@/components/utils/base64"

export default function ClientObjectCardPage() {
  const params = useSearchParams()
  const { datasetName, objectName } = useMemo(() => {
    const d = params.get("d") || ""
    const n = params.get("n") || ""
    let datasetName = ""
    let objectName = ""
    try { datasetName = d ? decodeBase64Utf8(d) : "" } catch { datasetName = "" }
    try { objectName = n ? decodeBase64Utf8(n) : "" } catch { objectName = "" }
    return { datasetName, objectName }
  }, [params])

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
          {objectName || "Object"}
        </Heading>
      </HStack>

      <Box mt={8}>
        <Text color="gray.600">ここにオブジェクトの詳細を表示します。</Text>
      </Box>
    </Box>
  )
}


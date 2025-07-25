import {
  Box,
  VStack,
} from "@chakra-ui/react"
import Image from "next/image"

export default async function Page() {
  return (
    <Box textAlign="center" fontSize="xl" pt="30vh">
      <VStack gap="8">
        <Image
          alt="chakra logo"
          src="/static/logo.svg"
          width="80"
          height="80"
        />
      </VStack>
    </Box>
  )
}

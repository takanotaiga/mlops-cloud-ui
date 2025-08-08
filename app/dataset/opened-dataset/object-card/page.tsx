"use client"

import {
  Box,
  Flex,
  VStack,
  Heading,
  Text,
  HStack,
  Badge,
  Button,
  Stack,
  Image as CImage,
} from "@chakra-ui/react"

// Reference image placed under public/static/object-card.png
const refImageSrc = "/static/object-card.png"

export default function Page() {
  return (
    <Box px="5%" py="20px">
      <HStack align="center" justify="space-between" pb="16px">
        <Heading size="2xl">Dataset / Person / Object</Heading>
        <HStack gap="2">
          <Button size="sm" variant="outline" rounded="full">Prev</Button>
          <Button size="sm" variant="outline" rounded="full">Next</Button>
        </HStack>
      </HStack>

      <Flex align="flex-start" gap="24px">
        {/* Left panel: object meta */}
        <VStack align="stretch" w={{ base: "100%", md: "20%" }} gap="16px">
          <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
            <Text fontWeight="bold" mb="8px">Object Info</Text>
            <Stack textStyle="sm" color="gray.600" gap="6px">
              <HStack justify="space-between"><Text>ID</Text><Text>obj-001</Text></HStack>
              <HStack justify="space-between"><Text>Source</Text><Text>hoge.MOV</Text></HStack>
              <HStack justify="space-between"><Text>Frame</Text><Text>128</Text></HStack>
              <HStack justify="space-between"><Text>Score</Text><Text>0.92</Text></HStack>
            </Stack>
            <Box my="12px" borderTopWidth="1px" />
            <Text fontWeight="bold" mb="8px">Labels</Text>
            <HStack wrap="wrap" gap="6px">
              <Badge colorPalette="green">Person</Badge>
              <Badge colorPalette="blue">Bounding Box</Badge>
              <Badge>Track-12</Badge>
            </HStack>
          </Box>

          <Box p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
            <Text fontWeight="bold" mb="8px">Attributes</Text>
            <Stack textStyle="sm" color="gray.600" gap="8px">
              <HStack justify="space-between"><Text>Occluded</Text><Text>No</Text></HStack>
              <HStack justify="space-between"><Text>Truncated</Text><Text>No</Text></HStack>
              <HStack justify="space-between"><Text>Direction</Text><Text>Front</Text></HStack>
            </Stack>
          </Box>
        </VStack>

        {/* Right content: reference image and actions */}
        <VStack flex="1" align="stretch" gap="16px">
          <Box rounded="md" overflow="hidden" borderWidth="1px" bg="white">
            <CImage src={refImageSrc} alt="object preview" w="100%" h="auto" />
          </Box>
        </VStack>
      </Flex>
    </Box>
  )
}

import { Box, VStack, HStack, Heading, Text, Button, SimpleGrid, Badge } from "@chakra-ui/react"
import NextLink from "next/link"

export default function Page() {
  return (
    <Box position="relative" overflow="hidden">
      <Box
        position="absolute"
        inset="0"
        bgGradient="radial( at 20% 10%, teal.200, transparent 40% ), radial( at 80% 20%, cyan.200, transparent 45% ), radial( at 50% 100%, purple.200, transparent 50% )"
        opacity={0.45}
        pointerEvents="none"
      />

      <VStack w="100%" pt="18vh" pb="8vh" px="6" position="relative">
        <VStack w={{ base: "100%", md: "70%" }} textAlign="center" gap="5">
          <Badge size="md" rounded="full" colorPalette="teal" variant="subtle">Introducing</Badge>
          <Heading size="4xl" lineHeight="1.1">MLOps Cloud</Heading>
          <Text color="gray.600" fontSize={{ base: "md", md: "lg" }}>
            Manage datasets, train models, and ship AI to production — all in one streamlined workflow.
          </Text>
          <HStack gap="3" pt="2">
            <NextLink href="/dataset" passHref>
              <Button rounded="full" size="md">Get Started</Button>
            </NextLink>
            <NextLink href="/trainning" passHref>
              <Button variant="outline" rounded="full" size="md">View Training</Button>
            </NextLink>
          </HStack>
        </VStack>
      </VStack>

      <VStack w="100%" pb="14vh" px="6" position="relative">
        <SimpleGrid w={{ base: "100%", md: "70%" }} columns={{ base: 1, md: 2, lg: 4 }} gap="6">
          <Box p="6" rounded="lg" borderWidth="1px" bg="bg.panel">
            <Heading size="md" mb="2">Dataset Management</Heading>
            <Text color="gray.600">Version, preview, and search datasets with ease.</Text>
          </Box>
          <Box p="6" rounded="lg" borderWidth="1px" bg="bg.panel">
            <Heading size="md" mb="2">Automated Training</Heading>
            <Text color="gray.600">Start, monitor, and tune runs from the UI.</Text>
          </Box>
          <Box p="6" rounded="lg" borderWidth="1px" bg="bg.panel">
            <Heading size="md" mb="2">Model Registry</Heading>
            <Text color="gray.600">Track best checkpoints and promote to prod.</Text>
          </Box>
          <Box p="6" rounded="lg" borderWidth="1px" bg="bg.panel">
            <Heading size="md" mb="2">Observability</Heading>
            <Text color="gray.600">Metrics, artifacts, and GPU usage in one place.</Text>
          </Box>
        </SimpleGrid>
      </VStack>
    </Box>
  )
}

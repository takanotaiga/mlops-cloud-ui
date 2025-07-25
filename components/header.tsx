import { Box, HStack, Heading, Text, Link } from "@chakra-ui/react"

export default function Header() {
    return (
        <Box
            as="header"
            bg="white"
            color="black"
            position="sticky"
            top="0"
            zIndex="sticky"
            borderBottomColor="gray.200"
            borderBottomWidth="1.0px"
            px={4} py={3}>
            <HStack justify="space-between" w="85%" maxW="7xl" mx="auto">
                <Link href="/" marginEnd="auto">
                    <Heading size="md" marginEnd="auto">MLOps Cloud</Heading>
                </Link>
                <Link href="/dataset" px="10px">
                    <Text textStyle="sm">Datasets</Text>
                </Link>
                <Link href="/trainning" px="10px">
                    <Text textStyle="sm">Trainning</Text>
                </Link>
                <Link href="/inference" px="10px">
                    <Text textStyle="sm">Inference</Text>
                </Link>
            </HStack>
        </Box>
    )
}
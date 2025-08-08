import { Box, HStack, Heading, Text, LinkBox, LinkOverlay } from "@chakra-ui/react"

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
                <LinkBox marginEnd="auto" h="25px">
                    <LinkOverlay href="/" >
                        <Heading size="md" marginEnd="auto">MLOps Cloud</Heading>
                    </LinkOverlay>
                </LinkBox>

                <LinkBox px="10px" h="25px">
                    <LinkOverlay href="/dataset" >
                        <Text textStyle="sm">Datasets</Text>
                    </LinkOverlay>
                </LinkBox>

                <LinkBox px="10px" h="25px">
                    <LinkOverlay href="/trainning">
                        <Text textStyle="sm">Trainning</Text>
                    </LinkOverlay>
                </LinkBox>

                <LinkBox px="10px" h="25px">
                    <LinkOverlay href="/inference" >
                        <Text textStyle="sm">Inference</Text>
                    </LinkOverlay>
                </LinkBox>
            </HStack>
        </Box>
    )
}
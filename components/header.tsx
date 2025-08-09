import { Box, HStack, Heading, Text, LinkBox, LinkOverlay, Badge } from "@chakra-ui/react"

import ConnectionStatus from "./status/connection-status"

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
            <HStack justify="space-between" align="center" w="85%" maxW="7xl" mx="auto">
                <LinkBox h="25px">
                    <LinkOverlay href="/" >
                        <HStack>
                            <Heading size="md" >MLOps Cloud</Heading>
                            <Badge size="md" rounded="full" colorPalette="purple" variant="subtle">Beta 1.0</Badge>
                        </HStack>
                    </LinkOverlay>
                </LinkBox>

                <Box h="25px" px="30px" display="flex" alignItems="center" marginEnd="auto">
                    <ConnectionStatus />
                </Box>

                <LinkBox px="10px" h="25px">
                    <LinkOverlay href="/dataset" >
                        <Text textStyle="sm">Datasets</Text>
                    </LinkOverlay>
                </LinkBox>

                <LinkBox px="10px" h="25px">
                    <LinkOverlay href="/training">
                        <Text textStyle="sm">Training</Text>
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

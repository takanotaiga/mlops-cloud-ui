import { Box, Heading, Text, Image, VStack, LinkOverlay, LinkBox } from "@chakra-ui/react"

export default function ImageCard() {
    return (
        <LinkBox px="10px" >
            <LinkOverlay href="/dataset/opened-dataset" px="10px">
                <Box bg="white" width="200px" pb="40px">
                    <VStack>
                        <Image
                            rounded="md"
                            h="200px"
                            shadow="lg"
                            src="https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/macs-value-tradein-202410?wid=1208&hei=758&fmt=png-alpha&.v=SXBYTUpZRmQwTG1WZ3c3cmVvUzlGY1BwbjUxU1oraGwyZERTK2xLcVB5VThiaG5uTzEvZjFDa0pGRWlwQjFsR0hSQnh1aXkxWm5SMFc1cnRPM2tyNklzMnlrQTVQaUZhdDJmTThSQTlCWGs"
                            alt="Dataset thumbnail"
                        />
                        <Heading size="lg" w="95%" fontWeight="medium" color="gray.900" textAlign="left">Person</Heading>
                        <Text textAlign="left" w="95%" fontWeight="normal" textStyle="sm" color="gray.500">This is the text component</Text>
                    </VStack>
                </Box>
            </LinkOverlay>
        </LinkBox>
    )
}

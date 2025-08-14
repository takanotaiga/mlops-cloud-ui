import { Box, Image, LinkOverlay, LinkBox } from "@chakra-ui/react";

export default function ContentCard() {
    return (
        <LinkBox px="10px" >
            <LinkOverlay href="/dataset/opened-dataset/object-card" px="10px">
                <Box bg="white" width="200px" pb="40px">
                    <Image
                        rounded="md"
                        h="200px"
                        shadow="lg"
                        src="https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/macs-value-tradein-202410?wid=1208&hei=758&fmt=png-alpha&.v=SXBYTUpZRmQwTG1WZ3c3cmVvUzlGY1BwbjUxU1oraGwyZERTK2xLcVB5VThiaG5uTzEvZjFDa0pGRWlwQjFsR0hSQnh1aXkxWm5SMFc1cnRPM2tyNklzMnlrQTVQaUZhdDJmTThSQTlCWGs"
                        alt="Content thumbnail"
                    />
                </Box>
            </LinkOverlay>
        </LinkBox>
    );
}

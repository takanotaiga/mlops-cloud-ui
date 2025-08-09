import React, { memo } from "react"
import { Box, Heading, Text, Image, VStack, LinkOverlay, LinkBox } from "@chakra-ui/react"

type ImageCardProps = {
  title?: string
  href?: string
}

function ImageCardBase({ title, href = "/dataset/opened-dataset" }: ImageCardProps) {
  return (
    <LinkBox px="10px" >
      <LinkOverlay href={href} px="10px">
        <Box bg="white" width="200px" pb="40px">
          <VStack>
            <Image
              rounded="md"
              h="200px"
              shadow="lg"
              src="/static/sample.jpg"
              alt="Dataset thumbnail"
            />
            {title && (
              <Heading size="lg" w="95%" fontWeight="medium" color="gray.900" textAlign="left">{title}</Heading>
            )}
            {title && (
              <Text textAlign="left" w="95%" fontWeight="normal" textStyle="sm" color="gray.500">This is the text component</Text>
            )}
          </VStack>
        </Box>
      </LinkOverlay>
    </LinkBox>
  )
}

export default memo(ImageCardBase)

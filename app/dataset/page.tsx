import {
  Text,
  HStack,
  VStack,
  Heading,
  Wrap,
  Button,
  Box,
  Input,
  InputGroup,
  Spacer,
} from "@chakra-ui/react"

import ImageCard from "@/components/image-card"
import { BsPlusCircleFill } from "react-icons/bs";
import { LuSearch } from "react-icons/lu"

import NextLink from "next/link"

export default async function Page() {
  return (
    <HStack justify="center">
      <VStack w="70%" >
        <HStack w="95%" justify="space-between" pb="40px" pt="30px">
          <Box alignSelf="flex-start" ml="30px">
            <HStack alignSelf="flex-start">
              <Heading size="2xl" >Datasets</Heading>
              <NextLink href="/dataset/upload" passHref>
                <Button variant="plain" rounded="full" w="10px" >
                  <BsPlusCircleFill color="#8E8E93" />
                </Button>
              </NextLink>
            </HStack>
            <Text textAlign="left" w="100%" fontWeight="normal" textStyle="sm" color="gray.500">This is the text component</Text>
          </Box>
          <Box alignSelf="flex-start" ml="30px">
            <Spacer h="10px" />
            <InputGroup flex="1" startElement={<LuSearch />} >
              <Input placeholder="Search contacts" size="sm" variant="flushed" />
            </InputGroup>
          </Box>
        </HStack>
        <Wrap align="end" gap="30px" mx="auto" justify="space-around">
          <ImageCard />
          <ImageCard />
          <ImageCard />
          <ImageCard />
        </Wrap>
      </VStack>
    </HStack>
  )
}

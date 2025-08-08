import {
  Text,
  HStack,
  VStack,
  Heading,
  SimpleGrid,
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

export default function Page() {
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
              <Input placeholder="Search datasets" size="sm" variant="flushed" />
            </InputGroup>
          </Box>
        </HStack>
        <SimpleGrid columns={[2, 3, 4]} gap="30px" mx="auto">
          {Array.from({ length: 4 }).map((_, i) => (
            <ImageCard key={i} />
          ))}
        </SimpleGrid>
      </VStack>
    </HStack>
  )
}

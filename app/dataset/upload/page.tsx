import {
  Text,
  HStack,
  VStack,
  Heading,
  Wrap,
  Button,
  Input,
  InputGroup,
  Spacer
} from "@chakra-ui/react"

import ImageCard from "@/components/image-card"
import { BsPlusCircleFill } from "react-icons/bs";
import { LuSearch } from "react-icons/lu"

import { Box, FileUpload, Icon } from "@chakra-ui/react"
import { LuUpload } from "react-icons/lu"

const Demo = () => {
  return (
    <FileUpload.Root maxW="xl" alignItems="stretch" maxFiles={1024}>
      <FileUpload.HiddenInput />
      <FileUpload.Dropzone>
        <Icon size="md" color="fg.muted">
          <LuUpload />
        </Icon>
        <FileUpload.DropzoneContent>
          <Box>Drag and drop files here</Box>
          <Box color="fg.muted">.png, .jpg up to 5MB</Box>
        </FileUpload.DropzoneContent>
      </FileUpload.Dropzone>
      <FileUpload.List />
    </FileUpload.Root>
  )
}


export default async function Page() {
  return (

    <HStack justify="center">
      <VStack w="70%" >
        <HStack w="95%" justify="space-between" pb="40px" pt="30px">
          <Box alignSelf="flex-start" ml="30px">
            <HStack alignSelf="flex-start">
              <Heading size="2xl" >Upload</Heading>
            </HStack>
          </Box>
        </HStack>

        <HStack w="95%" justify="space-between" pb="40px" pt="30px">
          <Box alignSelf="flex-start" ml="30px">
            <HStack alignSelf="flex-start">
              <Heading size="md" >Infomation</Heading>
            </HStack>

            <HStack alignSelf="flex-start">
              <Text w="100px">Image</Text>
              <Text minW="60px" textAlign="right">1,021</Text>
            </HStack>
            <HStack alignSelf="flex-start">
              <Text w="100px">Video</Text>
              <Text minW="60px" textAlign="right">10</Text>
            </HStack>

            <HStack alignSelf="flex-start">
              <Heading size="md" >Congiguration</Heading>
            </HStack>

            <HStack alignSelf="flex-start">
              <Text w="100px">Image</Text>
              <Text minW="60px" textAlign="right">1,021</Text>
            </HStack>
            <HStack alignSelf="flex-start">
              <Text w="100px">Video</Text>
              <Text minW="60px" textAlign="right">10</Text>
            </HStack>
          </Box>
        </HStack>
      </VStack>
    </HStack>
  )
}

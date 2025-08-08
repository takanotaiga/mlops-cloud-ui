"use client"

import {
  Text,
  Box,
  HStack,
  VStack,
  Heading,
  Button,
  Input,
  Select,
  createListCollection,
  Portal
} from "@chakra-ui/react"

import { FileUpload, Icon } from "@chakra-ui/react"
import { LuUpload } from "react-icons/lu"

import { LuCloudUpload } from "react-icons/lu";

const EncodeModeSelect = () => {
  return (
    <Select.Root collection={encodeModes} size="sm" width="320px">
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger>
          <Select.ValueText placeholder="Select encode mode" />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content>
            {encodeModes.items.map((item) => (
              <Select.Item item={item} key={item.value}>
                {item.label}
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  )
}

const encodeModes = createListCollection({
  items: [
    { label: "JPEG", value: "jpeg" },
    { label: "PNG", value: "png" },
    { label: "WebP", value: "webp" },
    { label: "AVIF", value: "avif" },
  ],
})


export default function Page() {
  return (

    <HStack justify="center">
      <VStack w="70%" >
        <HStack w="95%" justify="space-between" pt="40px">
          <Box alignSelf="flex-start" ml="30px">
            <HStack alignSelf="flex-start">
              <Heading size="2xl" >Upload</Heading>
            </HStack>
          </Box>
        </HStack>

        <HStack w="95%" justify="space-between" pb="40px" pt="40px">
          <Box alignSelf="flex-start" ml="30px">
            <HStack alignSelf="flex-start" pb="15px">
              <Heading size="md" >Infomation</Heading>
            </HStack>
            <HStack alignSelf="flex-start" pb="10px">
              <Text w="100px" ml="30px">Image</Text>
              <Text minW="60px" textAlign="right">1,021</Text>
            </HStack>
            <HStack alignSelf="flex-start" pb="10px">
              <Text w="100px" ml="30px">Video</Text>
              <Text minW="60px" textAlign="right">0</Text>
            </HStack>

            <HStack alignSelf="flex-start" pt="30px" pb="15px">
              <Heading size="md" >Congiguration</Heading>
            </HStack>

            <HStack alignSelf="flex-start" pb="30px">
              <Text w="200px" ml="30px">Dataset title</Text>
              <Input ml="30px" placeholder="Write here" variant="flushed" />
            </HStack>
            <HStack alignSelf="flex-start" pb="30px">
              <Text w="200px" ml="30px">Encode Mode</Text>
              <EncodeModeSelect />
            </HStack>
          </Box>
          <Box alignSelf="flex-start" ml="30px">
            <FileUpload.Root maxW="xl" alignItems="stretch" maxFiles={10}>
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
            </FileUpload.Root>
          </Box>
        </HStack>

        <HStack w="95%" justify="space-between" pb="40px" pt="40px">
          <Box alignSelf="flex-start" ml="30px">
            <Button variant="subtle" rounded="full" w="200px">
              <LuCloudUpload />
              Upload to cloud
            </Button>
          </Box>
        </HStack>
      </VStack>
    </HStack>
  )
}

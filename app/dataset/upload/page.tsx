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
import { useState, useCallback } from "react";

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
  const [error, setError] = useState<string | null>(null)
  const MAX_FILE_SIZE = 50 * 1024 * 1024 * 1024 // 50GB

  const handleFileChange = useCallback<React.ChangeEventHandler<HTMLInputElement>>(
    (e) => {
      const files = e.target.files ? Array.from(e.target.files) : []
      for (const file of files) {
        const isImage = file.type.startsWith("image/")
        const isVideo = file.type.startsWith("video/")
        if (!isImage && !isVideo) {
          setError("画像または動画のみアップロードできます")
          // reset selection
          e.target.value = ""
          return
        }
        if (file.size > MAX_FILE_SIZE) {
          setError("1ファイルあたり最大50GBまでです")
          e.target.value = ""
          return
        }
      }
      setError(null)
    },
    []
  )
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
              <Heading size="md" >Information</Heading>
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
              <Heading size="md" >Configuration</Heading>
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
              <FileUpload.HiddenInput accept="image/*,video/*" onChange={handleFileChange} />
              <FileUpload.Dropzone>
                <Icon size="md" color="fg.muted">
                  <LuUpload />
                </Icon>
                <FileUpload.DropzoneContent>
                  <Box>Drag and drop files here</Box>
                  <Box color="fg.muted">Images/Videos only, up to 50GB per file</Box>
                </FileUpload.DropzoneContent>
              </FileUpload.Dropzone>
            </FileUpload.Root>
            {error && (
              <Box color="red.500" mt="2" ml="2">
                {error}
              </Box>
            )}
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

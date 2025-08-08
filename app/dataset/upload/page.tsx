"use client"

import {
  Text,
  Box,
  HStack,
  VStack,
  Heading,
  Button,
  Input,
  Field,
  Select,
  createListCollection,
  Portal
} from "@chakra-ui/react"

import { FileUpload, Icon } from "@chakra-ui/react"
import { LuUpload } from "react-icons/lu"

import { LuCloudUpload } from "react-icons/lu";
import { useState, useCallback } from "react";

type EncodeModeSelectProps = {
  value: string
  onChange: (value: string) => void
}

const EncodeModeSelect = ({ value, onChange }: EncodeModeSelectProps) => {
  return (
    <Select.Root
      collection={encodeModes}
      size="sm"
      width="320px"
      value={value ? [value] : []}
      onValueChange={(details: any) => onChange(details?.value?.[0] ?? "")}
    >
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
  const [counts, setCounts] = useState<{ images: number; videos: number }>({ images: 0, videos: 0 })
  const [title, setTitle] = useState<string>("")
  const [titleInvalid, setTitleInvalid] = useState<boolean>(false)
  const [filesInvalid, setFilesInvalid] = useState<boolean>(false)
  const [encodeMode, setEncodeMode] = useState<string>("")
  const [encodeInvalid, setEncodeInvalid] = useState<boolean>(false)

  const handleFileChange = useCallback<React.ChangeEventHandler<HTMLInputElement>>(
    (e) => {
      const files = e.target.files ? Array.from(e.target.files) : []
      let images = 0
      let videos = 0
      if (files.length === 0) {
        setCounts({ images: 0, videos: 0 })
        setFilesInvalid(true)
        setError(null)
        return
      }
      for (const file of files) {
        const isImage = file.type.startsWith("image/")
        const isVideo = file.type.startsWith("video/")
        if (!isImage && !isVideo) {
          setError("画像または動画のみアップロードできます")
          // reset selection
          e.target.value = ""
          setCounts({ images: 0, videos: 0 })
          return
        }
        if (file.size > MAX_FILE_SIZE) {
          setError("1ファイルあたり最大50GBまでです")
          e.target.value = ""
          setCounts({ images: 0, videos: 0 })
          return
        }
        if (isImage) images += 1
        if (isVideo) videos += 1
      }
      setError(null)
      setCounts({ images, videos })
      setFilesInvalid(false)
    },
    []
  )

  const handleUploadClick = useCallback(() => {
    let invalid = false
    if (!title.trim()) {
      setTitleInvalid(true)
      invalid = true
    }
    if (counts.images + counts.videos === 0) {
      setFilesInvalid(true)
      invalid = true
    }
    if (!encodeMode) {
      setEncodeInvalid(true)
      invalid = true
    }
    if (invalid) return
    setTitleInvalid(false)
    // TODO: trigger actual upload flow
  }, [title, counts, encodeMode])
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
              <Text minW="60px" textAlign="right">{counts.images.toLocaleString()}</Text>
            </HStack>
            <HStack alignSelf="flex-start" pb="10px">
              <Text w="100px" ml="30px">Video</Text>
              <Text minW="60px" textAlign="right">{counts.videos.toLocaleString()}</Text>
            </HStack>

            <HStack alignSelf="flex-start" pt="30px" pb="15px">
              <Heading size="md" >Configuration</Heading>
            </HStack>

            <HStack alignSelf="flex-start" pb="30px">
              <Text w="200px" ml="30px">Dataset title</Text>
              <Field.Root invalid={titleInvalid}>
                <Input
                  ml="30px"
                  placeholder="Write here"
                  variant="flushed"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    if (titleInvalid && e.target.value.trim()) setTitleInvalid(false)
                  }}
                />
                {titleInvalid && (
                  <Field.ErrorText ml="30px">This field is required</Field.ErrorText>
                )}
              </Field.Root>
            </HStack>
            <HStack alignSelf="flex-start" pb="30px">
              <Text w="200px" ml="30px">Encode Mode</Text>
              <Field.Root invalid={encodeInvalid}>
                <Box ml="30px">
                  <EncodeModeSelect
                    value={encodeMode}
                    onChange={(v) => {
                      setEncodeMode(v)
                      if (encodeInvalid && v) setEncodeInvalid(false)
                    }}
                  />
                </Box>
                {encodeInvalid && (
                  <Field.ErrorText ml="30px">Please choose an encoding mode.</Field.ErrorText>
                )}
              </Field.Root>
            </HStack>
          </Box>
          <Box alignSelf="flex-start" ml="30px">
            <Field.Root invalid={filesInvalid}>
              <FileUpload.Root maxW="xl" alignItems="stretch" maxFiles={10}>
                <FileUpload.HiddenInput accept="image/*,video/*" multiple onChange={handleFileChange} />
                <FileUpload.Dropzone borderColor={filesInvalid ? "red.500" : undefined} borderWidth={filesInvalid ? "2px" : undefined}>
                  <Icon size="md" color="fg.muted">
                    <LuUpload />
                  </Icon>
                  <FileUpload.DropzoneContent>
                    <Box>Drag and drop files here</Box>
                    <Box color="fg.muted">Images/Videos only, up to 50GB per file</Box>
                  </FileUpload.DropzoneContent>
                </FileUpload.Dropzone>
              </FileUpload.Root>
              {filesInvalid && (
                <Field.ErrorText>Please select at least one file.</Field.ErrorText>
              )}
            </Field.Root>
            {error && (
              <Box color="red.500" mt="2" ml="2">
                {error}
              </Box>
            )}
          </Box>
        </HStack>

        <HStack w="95%" justify="space-between" pb="40px" pt="40px">
          <Box alignSelf="flex-start" ml="30px">
            <Button variant="subtle" rounded="full" w="200px" onClick={handleUploadClick}>
              <LuCloudUpload />
              Upload to cloud
            </Button>
          </Box>
        </HStack>
      </VStack>
    </HStack>
  )
}

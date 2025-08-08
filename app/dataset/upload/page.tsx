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
  Progress,
  Table,
  Select,
  createListCollection,
  Portal
} from "@chakra-ui/react"

import { FileUpload, Icon } from "@chakra-ui/react"
import { LuUpload } from "react-icons/lu"

import { LuCloudUpload } from "react-icons/lu";
import { useState, useCallback, useEffect } from "react";

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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [view, setView] = useState<"form" | "progress" | "done">("form")
  const [progress, setProgress] = useState<number[]>([])

  const handleFileChange = useCallback<React.ChangeEventHandler<HTMLInputElement>>(
    (e) => {
      const files = e.target.files ? Array.from(e.target.files) : []
      let images = 0
      let videos = 0
      if (files.length === 0) {
        setCounts({ images: 0, videos: 0 })
        setFilesInvalid(true)
        setError(null)
        setSelectedFiles([])
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
          setSelectedFiles([])
          return
        }
        if (file.size > MAX_FILE_SIZE) {
          setError("1ファイルあたり最大50GBまでです")
          e.target.value = ""
          setCounts({ images: 0, videos: 0 })
          setSelectedFiles([])
          return
        }
        if (isImage) images += 1
        if (isVideo) videos += 1
      }
      setError(null)
      setCounts({ images, videos })
      setFilesInvalid(false)
      setSelectedFiles(files)
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
    // Simulate upload progress within the page (no URL change)
    setProgress(new Array(selectedFiles.length).fill(0))
    setView("progress")
  }, [title, counts, encodeMode, selectedFiles.length])

  // Simulate per-file upload progress to 100% in 5 seconds
  useEffect(() => {
    if (view !== "progress") return
    const start = Date.now()
    const duration = 5000 // 5s
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      const ratio = Math.min(1, elapsed / duration)
      setProgress((prev) => prev.map(() => Math.round(ratio * 100)))
      if (ratio >= 1) {
        clearInterval(id)
        // Move to done view after a brief tick
        setView("done")
      }
    }, 100)
    return () => clearInterval(id)
  }, [view])
  if (view === "progress") {
    return (
      <HStack justify="center">
        <VStack w="70%">
          <HStack w="95%" justify="space-between" pt="40px">
            <Box alignSelf="flex-start" ml="30px">
              <HStack alignSelf="flex-start">
                <Heading size="2xl">Uploading</Heading>
              </HStack>
            </Box>
          </HStack>

          <Box w="95%" ml="30px" bg="bg.panel" p="16px" rounded="md" borderWidth="1px">
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>File</Table.ColumnHeader>
                  <Table.ColumnHeader>Progress</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">Percent</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {selectedFiles.map((file, idx) => (
                  <Table.Row key={file.name + idx}>
                    <Table.Cell>{file.name}</Table.Cell>
                    <Table.Cell>
                      <Progress.Root maxW="100%">
                        <Progress.Track>
                          <Progress.Range style={{ width: `${progress[idx] ?? 0}%` }} />
                        </Progress.Track>
                      </Progress.Root>
                    </Table.Cell>
                    <Table.Cell textAlign="end">{(progress[idx] ?? 0)}%</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        </VStack>
      </HStack>
    )
  }

  if (view === "done") {
    return (
      <HStack justify="center">
        <VStack w="70%">
          <HStack w="95%" justify="space-between" pt="40px">
            <Box alignSelf="flex-start" ml="30px">
              <HStack alignSelf="flex-start">
                <Heading size="2xl">Upload Complete</Heading>
              </HStack>
            </Box>
          </HStack>

          <Box w="95%" ml="30px" p="16px">
            <Text mb="8px">{selectedFiles.length} file(s) uploaded successfully.</Text>
            <HStack>
              <Button rounded="full" onClick={() => setView("form")}>Back</Button>
            </HStack>
          </Box>
        </VStack>
      </HStack>
    )
  }

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

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
  ProgressCircle,
  Badge,
  Table,
  Select,
  createListCollection,
  Portal,
  Image,
  SimpleGrid,
  CloseButton,
} from "@chakra-ui/react"

import { FileUpload, Icon } from "@chakra-ui/react"
import { LuUpload } from "react-icons/lu"

import { LuCloudUpload, LuPartyPopper, LuSparkles, LuCheck } from "react-icons/lu";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload as S3MultipartUpload } from "@aws-sdk/lib-storage";
import { MINIO_CONFIG } from "@/app/secrets/minio-config";
import { useState, useCallback, useRef, useEffect } from "react";
import NextLink from "next/link"
import { useSurrealClient } from "@/components/surreal/SurrealProvider";
import { FILE_UPLOAD_CONCURRENCY } from "@/app/dataset/upload/parameters";

type EncodeModeSelectProps = {
  value: string
  onChange: (value: string) => void
  collection: any
}

const EncodeModeSelect = ({ value, onChange, collection }: EncodeModeSelectProps) => {
  return (
    <Select.Root
      collection={collection as any}
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
            {(collection as any).items.map((item: any) => (
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

const makeVideoEncodeModes = (hasLongVideo15: boolean, hasMultipleVideos: boolean) =>
  createListCollection({
    items: [
      ...(hasMultipleVideos ? [{ label: "All Merge", value: "video-merge" }] : []),
      ...(hasLongVideo15 ? [{ label: "TimeLaps(15min)", value: "video-timelaps-15" }] : []),
      { label: "Convert To Image", value: "video-to-image" },
      { label: "Do Nothing", value: "video-none" },
    ],
  })


export default function Page() {
  const surreal = useSurrealClient()
  const [error, setError] = useState<string | null>(null)
  const MAX_FILE_SIZE = 50 * 1024 * 1024 * 1024 // 50GB
  const [counts, setCounts] = useState<{ images: number; videos: number }>({ images: 0, videos: 0 })
  const [title, setTitle] = useState<string>("")
  const [titleInvalid, setTitleInvalid] = useState<boolean>(false)
  const [filesInvalid, setFilesInvalid] = useState<boolean>(false)
  const [encodeMode, setEncodeMode] = useState<string>("")
  const [encodeInvalid, setEncodeInvalid] = useState<boolean>(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [videoThumbs, setVideoThumbs] = useState<(string | null)[]>([])
  const [hasLongVideo15, setHasLongVideo15] = useState<boolean>(false)
  const [view, setView] = useState<"form" | "progress" | "done">("form")
  const [progress, setProgress] = useState<number[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const resetFileSelection = useCallback(() => {
    setSelectedFiles([])
    setCounts({ images: 0, videos: 0 })
    setFilesInvalid(false)
    setError(null)
    setProgress([])
    if (fileInputRef.current) {
      try { fileInputRef.current.value = "" } catch { }
    }
  }, [])

  // Generate/revoke object URLs for previews
  useEffect(() => {
    const urls = selectedFiles.map((f) => URL.createObjectURL(f))
    setPreviewUrls(urls)
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [selectedFiles])

  // Create image thumbnails for video files so we can show a static preview
  useEffect(() => {
    let cancelled = false
    const makeThumb = async (_file: File, url: string): Promise<{ thumb: string | null; durationSec: number }> => {
      return new Promise((resolve) => {
        try {
          const video = document.createElement('video')
          video.src = url
          video.muted = true
          video.playsInline = true
          video.preload = 'metadata'
          const cleanup = () => {
            video.src = ''
            video.remove()
          }
          const onLoaded = () => {
            // Seek a little into the video to avoid black frames
            const dur = Number.isFinite(video.duration) ? video.duration : 0
            const targetTime = Math.min(Math.max(1.0, dur * 0.15), Math.max(0, dur - 0.5))
            const capture = () => {
              try {
                const w = video.videoWidth || 320
                const h = video.videoHeight || 180
                const canvas = document.createElement('canvas')
                // Keep aspect ratio and cap the longer side for a sharper image
                const MAX_DIM = 1280
                const scale = Math.min(MAX_DIM / Math.max(w, h), 1)
                const dw = Math.max(1, Math.round(w * scale))
                const dh = Math.max(1, Math.round(h * scale))
                canvas.width = dw
                canvas.height = dh
                const ctx = canvas.getContext('2d')
                if (!ctx) throw new Error('no ctx')
                ctx.imageSmoothingEnabled = true
                // high-quality resampling where supported
                ;(ctx as any).imageSmoothingQuality = 'high'
                ctx.drawImage(video, 0, 0, dw, dh)
                const dataUrl = canvas.toDataURL('image/jpeg', 0.95)
                cleanup()
                resolve({ thumb: dataUrl, durationSec: dur })
              } catch (e) {
                cleanup()
                resolve({ thumb: null, durationSec: 0 })
              }
            }
            const onSeeked = () => capture()
            video.currentTime = targetTime > 0 ? targetTime : 0
            video.addEventListener('seeked', onSeeked, { once: true })
          }
          // Use loadedmetadata to get dimensions/duration quickly; then seek to capture
          video.addEventListener('loadedmetadata', onLoaded, { once: true })
          video.addEventListener('error', () => {
            cleanup()
            resolve({ thumb: null, durationSec: 0 })
          }, { once: true })
        } catch {
          resolve({ thumb: null, durationSec: 0 })
        }
      })
    }

    const run = async () => {
      const results: (string | null)[] = []
      let anyLong = false
      for (let i = 0; i < selectedFiles.length; i++) {
        const f = selectedFiles[i]
        const url = previewUrls[i]
        if (f && url && f.type.startsWith('video/')) {
          const { thumb, durationSec } = await makeThumb(f, url)
          results[i] = thumb
          if (durationSec >= 900) anyLong = true
        } else {
          results[i] = null
        }
        if (cancelled) return
      }
      if (!cancelled) {
        setVideoThumbs(results)
        setHasLongVideo15(anyLong)
      }
    }

    if (selectedFiles.length > 0) run()
    else { setVideoThumbs([]); setHasLongVideo15(false) }

    return () => { cancelled = true }
  }, [selectedFiles, previewUrls])
  // uploading state omitted; we infer from view/progress

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

  const removeFileAt = useCallback((index: number) => {
    setSelectedFiles((prev) => {
      const next = prev.filter((_, i) => i !== index)
      let images = 0
      let videos = 0
      for (const file of next) {
        if (file.type.startsWith("image/")) images += 1
        else if (file.type.startsWith("video/")) videos += 1
      }
      setCounts({ images, videos })
      if (next.length === 0) {
        setFilesInvalid(false)
      }
      return next
    })
  }, [])

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
    if (counts.videos > 0 && !encodeMode) {
      setEncodeInvalid(true)
      invalid = true
    }
    if (invalid) return
    setTitleInvalid(false)
    // Start real upload to MinIO (URL unchanged)
    setProgress(new Array(selectedFiles.length).fill(0))
    setView("progress")
    const client = new S3Client({
      region: MINIO_CONFIG.region,
      endpoint: MINIO_CONFIG.endpoint,
      forcePathStyle: MINIO_CONFIG.forcePathStyle,
      credentials: {
        accessKeyId: MINIO_CONFIG.accessKeyId,
        secretAccessKey: MINIO_CONFIG.secretAccessKey,
      },
    })

    const toUint8Array = (dataUrl: string): Uint8Array => {
      // data:[<mediatype>][;base64],<data>
      const parts = dataUrl.split(',')
      const b64 = parts[1] || ''
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return bytes
    }

    const getThumbKeyFor = (dataset: string, name: string) => {
      const base = name.replace(/\/+$/, '')
      return `${dataset}/.thumbs/${base}.jpg`
    }

    const tasks = selectedFiles.map((file, idx) => () => {
      const Key = `${title}/${file.name}`
      const uploader = new S3MultipartUpload({
        client,
        params: {
          Bucket: MINIO_CONFIG.bucket,
          Key,
          Body: file,
          ContentType: file.type || "application/octet-stream",
        },
        queueSize: 3,
        partSize: 100 * 1024 * 1024,
        leavePartsOnError: false,
      })

      uploader.on("httpUploadProgress", (evt: any) => {
        const loaded = evt.loaded ?? 0
        const total = evt.total ?? file.size
        const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0
        setProgress((prev) => {
          const next = [...prev]
          next[idx] = Math.max(next[idx] ?? 0, pct)
          return next
        })
      })

      return uploader.done().then(async () => {
        // If this is a video and we have a generated thumbnail, upload it too
        if (file.type.startsWith('video/')) {
          const thumbDataUrl = videoThumbs[idx]
          if (thumbDataUrl) {
            try {
              const Body = toUint8Array(thumbDataUrl)
              const ThumbKey = getThumbKeyFor(title, file.name)
              await client.send(new PutObjectCommand({
                Bucket: MINIO_CONFIG.bucket,
                Key: ThumbKey,
                Body,
                ContentType: 'image/jpeg',
              }))
            } catch (e) {
              // Non-fatal: continue even if thumbnail upload fails
              console.warn('Thumbnail upload failed for', file.name, e)
            }
          }
        }
        setProgress((prev) => {
          const next = [...prev]
          next[idx] = 100
          return next
        })
      })
    })

    const runWithConcurrency = async <T,>(jobFns: Array<() => Promise<T>>, limit: number) => {
      const results: T[] = []
      let i = 0
      let active = 0
      let rejected = false
      return new Promise<T[]>((resolve, reject) => {
        const runNext = () => {
          if (rejected) return
          if (i >= jobFns.length && active === 0) {
            resolve(results)
            return
          }
          while (active < Math.max(1, limit) && i < jobFns.length) {
            const idxJob = i++
            active++
            jobFns[idxJob]()
              .then((res) => {
                results[idxJob] = res as T
              })
              .catch((err) => {
                rejected = true
                reject(err)
              })
              .finally(() => {
                active--
                if (!rejected) runNext()
              })
          }
        }
        runNext()
      })
    }

    runWithConcurrency(tasks, FILE_UPLOAD_CONCURRENCY)
      .then(async () => {
        try {
          // Register file metadata to SurrealDB after all uploads complete
          const now = new Date().toISOString()
          for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i]
            const key = `${title}/${file.name}`
            const thumbKey = file.type.startsWith('video/') && videoThumbs[i]
              ? `${title}/.thumbs/${file.name}.jpg`
              : undefined
            try {
              await surreal.query(
                "CREATE file SET name = $name, key = $key, bucket = $bucket, size = $size, mime = $mime, dataset = $dataset, encode = $encode, uploadedAt = time::now(), thumbKey = $thumbKey",
                {
                  name: file.name,
                  key,
                  bucket: MINIO_CONFIG.bucket,
                  size: file.size,
                  mime: file.type || "application/octet-stream",
                  dataset: title,
                  encode: counts.videos > 0 ? encodeMode : undefined,
                  now,
                  thumbKey,
                },
              )
            } catch (e) {
              console.error("Failed to register file in SurrealDB:", file.name, e)
            }
          }
        } catch (e) {
          console.error("SurrealDB registration error:", e)
        } finally {
          setView("done")
        }
      })
      .catch((err) => {
        console.error("Upload failed", err)
        setError("アップロードに失敗しました。設定やネットワークを確認してください。")
        setView("form")
      })
  }, [title, counts, encodeMode, selectedFiles.length])
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
                <Icon color="green.500" boxSize={8}>
                  <LuPartyPopper />
                </Icon>
                <Heading size="2xl">Upload Complete</Heading>
                <Icon color="purple.500" boxSize={7}>
                  <LuSparkles />
                </Icon>
              </HStack>
            </Box>
          </HStack>

          <Box w="95%" ml="30px" p="16px" rounded="md" borderWidth="1px" bg="bg.panel">
            <HStack justify="space-between" align="center" mb="16px">
              <HStack>
                <Badge colorPalette="green" variant="solid">Success</Badge>
                <Text>全ファイルのアップロードが完了しました。素晴らしいスタートです！</Text>
              </HStack>
              <ProgressCircle.Root value={100} size="lg">
                <ProgressCircle.Circle>
                  <ProgressCircle.Track />
                  <ProgressCircle.Range colorPalette="green" />
                </ProgressCircle.Circle>
              </ProgressCircle.Root>
            </HStack>

            <HStack gap="24px" mb="16px">
              <Badge>Dataset: {title || "(no title)"}</Badge>
              {counts.videos > 0 && (
                <Badge>Encode: {encodeMode || "(none)"}</Badge>
              )}
              <Badge>Files: {selectedFiles.length}</Badge>
            </HStack>

            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>File</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {selectedFiles.map((file, idx) => (
                  <Table.Row key={file.name + idx}>
                    <Table.Cell>{file.name}</Table.Cell>
                    <Table.Cell>
                      <HStack>
                        <Icon color="green.500">
                          <LuCheck />
                        </Icon>
                        <Text>Completed</Text>
                      </HStack>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>

            <HStack mt="16px" gap="12px">
              <Button rounded="full" onClick={() => { resetFileSelection(); setView("form") }}>Upload more</Button>
              <NextLink href="/dataset" passHref>
                <Button rounded="full" variant="outline">Explore datasets</Button>
              </NextLink>
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
            {counts.videos > 0 && (
              <HStack alignSelf="flex-start" pb="30px">
                <Text w="200px" ml="30px">Video Encode mode</Text>
                <Field.Root invalid={encodeInvalid}>
                  <Box ml="30px">
                    <EncodeModeSelect
                      value={encodeMode}
                      collection={makeVideoEncodeModes(hasLongVideo15, counts.videos > 1)}
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
            )}
            <HStack alignSelf="flex-start" ml="30px" pt="8px">
              <Button variant="subtle" rounded="full" w="220px" onClick={handleUploadClick}>
                <LuCloudUpload />
                Upload to cloud
              </Button>
            </HStack>
          </Box>
          <Box alignSelf="flex-start" ml="30px">
            <Field.Root invalid={filesInvalid}>
              <FileUpload.Root maxW="xl" alignItems="stretch" maxFiles={10}>
                <FileUpload.HiddenInput
                  accept="image/*,video/*"
                  multiple
                  onChange={handleFileChange}
                  ref={(el) => { fileInputRef.current = el as unknown as HTMLInputElement | null }}
                />
                <VStack alignItems="stretch" gap="3">
                  <Button onClick={() => fileInputRef.current?.click()} variant="surface" rounded="md">
                    <HStack>
                      <Icon>
                        <LuUpload />
                      </Icon>
                      <Text>ファイルを選択</Text>
                    </HStack>
                  </Button>
                </VStack>
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
            {selectedFiles.length > 0 && (
              <Box mt="4">
                <Text mb="2" color="fg.muted">選択済み: {selectedFiles.length} ファイル</Text>
                <SimpleGrid columns={{ base: 2, md: 3 }} gap="3">
                  {selectedFiles.map((file, i) => {
                    const isImage = file.type.startsWith("image/")
                    const isVideo = file.type.startsWith("video/")
                    const url = previewUrls[i]
                    return (
                      <Box key={file.name + i} borderWidth="1px" rounded="md" overflow="hidden" bg="bg.panel" position="relative">
                        <Box position="absolute" top="1" right="1" zIndex={1}>
                          <CloseButton size="sm" onClick={() => removeFileAt(i)} aria-label={`Remove ${file.name}`} />
                        </Box>
                        <Box style={{ aspectRatio: 1 as any }} bg="bg.subtle" overflow="hidden">
                          {isImage && url && (
                            <Image src={url} alt={file.name} objectFit="cover" w="100%" h="100%" />
                          )}
                          {isVideo && (
                            videoThumbs[i] ? (
                              <Image src={videoThumbs[i] as string} alt={file.name} objectFit="cover" w="100%" h="100%" />
                            ) : (
                              <Box w="100%" h="100%" display="grid" placeItems="center" color="fg.muted">Generating preview…</Box>
                            )
                          )}
                        </Box>
                        <Box p="2">
                          <Text fontSize="sm" style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{file.name}</Text>
                        </Box>
                      </Box>
                    )
                  })}
                </SimpleGrid>
              </Box>
            )}
          </Box>
        </HStack>
      </VStack>
    </HStack>
  )
}

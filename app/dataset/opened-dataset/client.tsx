"use client";

import {
  Box,
  Flex,
  VStack,
  SimpleGrid,
  Heading,
  Button,
  CheckboxGroup,
  Checkbox,
  Fieldset,
  Text,
  HStack,
  For,
  Select,
  createListCollection,
  Grid,
  GridItem,
  Link,
  Image,
  Skeleton,
  SkeletonText,
  Center,
  Spinner,
  Dialog,
  Portal,
  CloseButton,
 Badge, Accordion } from "@chakra-ui/react";
import { useSearchParams , useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { decodeBase64Utf8, encodeBase64Utf8 } from "@/components/utils/base64";
import NextLink from "next/link";
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { extractRows } from "@/components/surreal/normalize";
import { getObjectUrlPreferPresign } from "@/components/utils/minio";
import { useI18n } from "@/components/i18n/LanguageProvider";

export default function ClientOpenedDatasetPage() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const datasetName = useMemo(() => {
    const d = params.get("d");
    if (!d) return "";
    try {
      return decodeBase64Utf8(d);
    } catch {
      return "";
    }
  }, [params]);
  const refreshToken = useMemo(() => params.get("r") || "", [params]);

  const surreal = useSurrealClient();
  const { isSuccess } = useSurreal();

  type FileRow = {
    bucket: string
    dataset: string
    encode?: string
    id: string
    key: string
    mime?: string
    name: string
    size?: number
    uploadedAt?: string
    thumbKey?: string
    dead?: boolean
  }

  // Normalize SurrealDB Thing values (e.g., id) to strings for safe usage
  type ThingLike = { tb: string; id: unknown }
  function thingToString(v: unknown): string {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object" && v !== null && "tb" in (v as any) && "id" in (v as any)) {
      const t = v as ThingLike;
      const id = typeof t.id === "object" && t.id !== null
        ? ((t.id as any).toString?.() ?? JSON.stringify(t.id))
        : String(t.id);
      return `${t.tb}:${id}`;
    }
    return String(v);
  }

  const { data: files = [], isPending, isError, error, refetch } = useQuery({
    queryKey: ["dataset-files", datasetName, refreshToken],
    enabled: isSuccess && !!datasetName,
    queryFn: async () => {
      const res = await surreal.query("SELECT * FROM file WHERE dataset == $dataset ORDER BY name ASC", { dataset: datasetName });
      const rows = extractRows<any>(res).filter((r: any) => r?.dead !== true);
      // Ensure id (and dataset if needed) are strings
      return rows.map((r: any) => ({
        ...r,
        id: thingToString(r?.id),
        dataset: typeof r?.dataset === "string" ? r.dataset : thingToString(r?.dataset),
      })) as FileRow[];
    },
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  });

  const [imgUrls, setImgUrls] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState(false);
  const filesByName = useMemo(() => Object.fromEntries((files || []).map((ff) => [String(ff.name), ff])), [files]);

  // HLS job status per file in this dataset
  type HlsStatus = "complete" | "in_progress" | "queued" | "unknown";
  const { data: hlsStatusMap = {} } = useQuery({
    queryKey: ["hls-status", datasetName, refreshToken],
    enabled: isSuccess && !!datasetName,
    queryFn: async () => {
      // Fetch latest HLS job per file (order by created_at desc and take first seen)
      const res = await surreal.query(
        "SELECT file, status, created_at FROM hls_job WHERE file.dataset == $dataset ORDER BY created_at DESC",
        { dataset: datasetName }
      );
      const rows = extractRows<any>(res);
      const map: Record<string, HlsStatus> = {};
      for (const r of rows) {
        const fid = thingToString(r?.file);
        if (!fid || map[fid]) continue; // keep the latest seen first
        const st = String(r?.status ?? "").toLowerCase();
        const isComplete = st === "complete" || st === "completed" || st === "finished" || st === "success" || st === "succeeded" || st === "done";
        const isQueued = st === "queued" || st === "queue" || st === "waiting" || st === "pending";
        const isInProgress = st === "in_progress" || st === "processing" || st === "running";
        map[fid] = isComplete ? "complete" : (isQueued ? "queued" : (isInProgress ? "in_progress" : "unknown"));
      }
      return map;
    },
    refetchOnWindowFocus: false,
    staleTime: 5_000,
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
  });

  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout")), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
    });
  }

  async function handleRemoveDataset() {
    if (!datasetName || removing) return;
    setRemoving(true);
    try {
      await withTimeout((async () => {
        // Soft-delete: mark files as dead within this dataset. No S3 or other table deletions.
        await surreal.query("UPDATE file SET dead = true WHERE dataset = $dataset", { dataset: datasetName });
      })(), 3000);
    } catch {
      // timeout or error: continue navigation without blocking the user
    } finally {
      // Invalidate caches and navigate back to dataset list with refresh token
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      const r = Date.now().toString();
      router.push(`/dataset?r=${encodeURIComponent(r)}`);
      setRemoving(false);
    }
  }

  // Label Type filtering (include / exclude / any)
  const LABEL_TYPES = useMemo(() => ["Bounding Box", "OneShotBBox"] as const, []);
  type LabelType = (typeof LABEL_TYPES)[number]
  type LabelMode = "any" | "has" | "no"
  const [labelFilter, setLabelFilter] = useState<Record<LabelType, LabelMode>>({
    "Bounding Box": "any",
    "OneShotBBox": "any",
  });

  // Load per-file annotation categories to determine label presence
  const { data: labelPresence = {} } = useQuery({
    queryKey: ["dataset-label-presence", datasetName],
    enabled: isSuccess && !!datasetName,
    queryFn: async () => {
      try {
        const res = await surreal.query(
          "SELECT file, array::distinct(category) AS cats FROM annotation WHERE dataset == $dataset GROUP BY file",
          { dataset: datasetName }
        );
        const rows = extractRows<any>(res);
        const map: Record<string, { bbox: boolean; one: boolean }> = {};
        for (const r of rows) {
          const fid = thingToString(r?.file);
          const cats = Array.isArray(r?.cats) ? r.cats.map((c: any) => String(c)) : [];
          const bbox = cats.some((c: string) => /\bimage_bbox\b/i.test(c) || /\bbbox\b/i.test(c));
          const one = cats.some((c: string) => c === "sam2_key_bbox");
          map[fid] = { bbox, one };
        }
        return map;
      } catch {
        return {};
      }
    },
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  });

  const labelModeCollection = useMemo(() => createListCollection({
    items: [
      { label: "Any", value: "any" },
      { label: "Has", value: "has" },
      { label: "No", value: "no" },
    ],
  }), []);

  // Media type filtering
  const MEDIA_OPTIONS = useMemo(() => ["Video", "Image"] as const, []);
  type MediaType = (typeof MEDIA_OPTIONS)[number]
  const [selectedMedia, setSelectedMedia] = useState<MediaType[]>([...MEDIA_OPTIONS]);

  const classifyMedia = useCallback((f: FileRow): MediaType | "Other" => {
    const mime = (f.mime || "").toLowerCase();
    if (mime.startsWith("image/")) return "Image";
    if (mime.startsWith("video/")) return "Video";
    // Extension fallback
    const key = (f.name || f.key || "").toLowerCase();
    if (key.endsWith(".jpg") || key.endsWith(".jpeg") || key.endsWith(".png") || key.endsWith(".webp") || key.endsWith(".gif") || key.endsWith(".avif")) return "Image";
    if (key.endsWith(".mp4") || key.endsWith(".mov") || key.endsWith(".mkv") || key.endsWith(".avi") || key.endsWith(".webm")) return "Video";
    return "Other";
  }, []);

  const visibleFiles = useMemo(() => {
    if (!files || selectedMedia.length === 0) return [];
    const set = new Set(selectedMedia);
    return files.filter((f) => {
      if (!set.has(classifyMedia(f) as MediaType)) return false;
      const pres = labelPresence[f.id] ?? { bbox: false, one: false };
      // Apply include/exclude per label type (AND combination)
      const checks: [LabelType, boolean][] = [["Bounding Box", pres.bbox], ["OneShotBBox", pres.one]];
      for (const [lt, has] of checks) {
        const mode = labelFilter[lt];
        if (mode === "has" && !has) return false;
        if (mode === "no" && has) return false;
      }
      return true;
    });
  }, [files, selectedMedia, labelPresence, labelFilter, classifyMedia]);

  // Load merge group for this dataset when present to detect "All Merge" first item
  const { data: mergeInfo } = useQuery({
    queryKey: ["merge-group", datasetName],
    enabled: isSuccess && !!datasetName,
    queryFn: async () => {
      try {
        const res = await surreal.query("SELECT * FROM merge_group WHERE dataset == $dataset AND mode == 'all' LIMIT 1", { dataset: datasetName });
        const rows = extractRows<any>(res);
        const row = rows?.[0];
        if (!row || !Array.isArray(row.members)) return null as any;
        const members: string[] = row.members.map((n: any) => String(n));
        return { members, first: members[0] as string | undefined };
      } catch {
        return null as any;
      }
    },
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });

  const sortedVisibleFiles = useMemo(() => {
    // If dataset has an All Merge sequence, only show the first merged video
    const onlyFirst = (f: FileRow) => {
      if (!mergeInfo || !mergeInfo.first) return true;
      if ((f.encode || "") !== "video-merge") return true;
      // When encode mode is video-merge, show only the first name
      return String(f.name || "") === String(mergeInfo.first || "");
    };
    const base = visibleFiles.filter(onlyFirst);
    return [...base].sort((a, b) => {
      const an = (a.name || a.key || "").toString();
      const bn = (b.name || b.key || "").toString();
      return an.localeCompare(bn, undefined, { sensitivity: "base", numeric: true });
    });
  }, [visibleFiles, mergeInfo]);

  // Pagination (20 items per page)
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(0);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(sortedVisibleFiles.length / PAGE_SIZE)), [sortedVisibleFiles.length]);
  const clampedPage = Math.min(page, totalPages - 1);
  const pageFiles = useMemo(() => {
    const start = clampedPage * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return sortedVisibleFiles.slice(start, end);
  }, [sortedVisibleFiles, clampedPage]);

  // Reset to first page when dataset or filters change
  useEffect(() => {
    setPage(0);
  }, [datasetName, selectedMedia, labelFilter]);

  useEffect(() => {
    // If there are no files, clear once if needed and exit without updating state repeatedly.
    if (!pageFiles || pageFiles.length === 0) {
      setImgUrls((prev) => {
        if (Object.keys(prev).length === 0) return prev;
        Object.values(prev).forEach((u) => { if (u.startsWith("blob:")) URL.revokeObjectURL(u); });
        return {};
      });
      return;
    }

    let cancelled = false;
    const createdBlobs: string[] = [];
    const run = async () => {
      const next: Record<string, string> = {};
      for (const f of pageFiles) {
        const isImage = (f.mime || "").startsWith("image/");
        const isVideoWithThumb = (f.mime || "").startsWith("video/") && !!f.thumbKey;
        if (isImage || isVideoWithThumb) {
          try {
            const keyToFetch = isImage ? f.key : (f.thumbKey as string);
            const { url, isBlob } = await getObjectUrlPreferPresign(f.bucket, keyToFetch);
            if (cancelled) return;
            next[f.key] = url; // map by file key for rendering lookup
            if (isBlob) createdBlobs.push(url);
          } catch {
            // ignore errors for individual objects
          }
        }
      }
      if (cancelled) return;
      setImgUrls((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === next[k])) {
          return prev;
        }
        return next;
      });
    };
    run();
    return () => {
      cancelled = true;
      createdBlobs.forEach((u) => { try { URL.revokeObjectURL(u); } catch { void 0; } });
    };
  }, [pageFiles]);

  // mergeInfo defined above

  // Responsive grid columns using Chakra breakpoints. Adjust as needed.
  // Keys: base, sm, md, lg, xl, 2xl
  const GRID_COLUMNS = useMemo(() => ({
    base: 1,
    sm: 2,
    md: 3,
    lg: 3,
    xl: 4,
  }), []);

  // Responsive horizontal padding (px) for the page container
  // Edit these values to tune per breakpoint
  const PAGE_PX = useMemo(() => ({
    base: "12px",
    sm: "3%",
    md: "5%",
    lg: "3%",
    xl: "5%",
  }), []);

  // Reusable filter controls (split into two blocks for accordion usage on small screens)
  function LabelFilterControls({ showLegend = true }: { showLegend?: boolean }) {
    return (
      <Fieldset.Root>
        {showLegend && (
          <Fieldset.Legend>
            <Text fontWeight="bold">Label Type</Text>
          </Fieldset.Legend>
        )}
        <Fieldset.Content>
          <Grid templateColumns="1fr 150px" columnGap={3} rowGap={2} alignItems="center">
            {LABEL_TYPES.map((lt) => (
              <Fragment key={lt}>
                <GridItem>
                  <Text>{lt}</Text>
                </GridItem>
                <GridItem>
                  <Select.Root
                    collection={labelModeCollection as any}
                    size="sm"
                    value={labelFilter[lt as LabelType] ? [labelFilter[lt as LabelType]] : []}
                    onValueChange={(details: any) => {
                      const value = (details?.value?.[0] ?? "any") as LabelMode;
                      setLabelFilter((prev) => ({ ...prev, [lt as LabelType]: value }));
                    }}
                  >
                    <Select.HiddenSelect />
                    <Select.Control w="150px">
                      <Select.Trigger>
                        <Select.ValueText placeholder="Any" />
                      </Select.Trigger>
                      <Select.IndicatorGroup>
                        <Select.Indicator />
                      </Select.IndicatorGroup>
                    </Select.Control>
                    <Portal>
                      <Select.Positioner>
                        <Select.Content>
                          {(labelModeCollection as any).items.map((item: any) => (
                            <Select.Item item={item} key={item.value}>
                              {item.label}
                              <Select.ItemIndicator />
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Positioner>
                    </Portal>
                  </Select.Root>
                </GridItem>
              </Fragment>
            ))}
          </Grid>
        </Fieldset.Content>
      </Fieldset.Root>
    );
  }

  function MediaFilterControls({ showLegend = true }: { showLegend?: boolean }) {
    return (
      <Fieldset.Root>
        {showLegend && (
          <Fieldset.Legend>
            <Text fontWeight="bold">Media Type</Text>
          </Fieldset.Legend>
        )}
        <Fieldset.Content>
          <CheckboxGroup
            name="media"
            value={selectedMedia}
            onValueChange={(e: any) => {
              const next = (e?.value ?? e) as string[];
              setSelectedMedia(next.filter((v) => (MEDIA_OPTIONS as readonly string[]).includes(v)) as MediaType[]);
            }}
          >
            <For each={MEDIA_OPTIONS as unknown as string[]}>
              {(value) => (
                <Checkbox.Root key={value} value={value}>
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                  <Checkbox.Label>{value}</Checkbox.Label>
                </Checkbox.Root>
              )}
            </For>
          </CheckboxGroup>
        </Fieldset.Content>
      </Fieldset.Root>
    );
  }

  return (
    <Box px={PAGE_PX} py="20px">
      <HStack align="center" justify="space-between">
        <HStack gap="3" align="center">
          <Heading size="2xl" >
            <Link
              asChild
              color="black"
              textDecoration="none"
              _hover={{ textDecoration: "none", color: "black" }}
              _focusVisible={{ outline: "none", boxShadow: "none" }}
              _active={{ outline: "none", boxShadow: "none" }}
            >
              <NextLink href="/dataset">{t("dataset.breadcrumb", "Datasets 📚")}</NextLink>
            </Link>
            {" / "}
            {datasetName || "(unknown)"}
          </Heading>
          <Badge rounded="full" variant="subtle" colorPalette="purple">Datasets</Badge>
        </HStack>

        <Box mt={8} textAlign="right" pb="10px">
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Button variant="outline" colorPalette="red" size="sm" rounded="full" disabled={removing}>
                Remove
              </Button>
            </Dialog.Trigger>
            <Portal>
              <Dialog.Backdrop />
              <Dialog.Positioner>
                <Dialog.Content>
                  <Dialog.Header>
                    <Dialog.Title>Delete Dataset</Dialog.Title>
                  </Dialog.Header>
                  <Dialog.Body>
                    <Text>データセット「{datasetName}」配下のファイルに削除フラグを付けます。よろしいですか？</Text>
                    <Text mt={2} color="gray.600">S3 や他のテーブルの実体は削除しません（ソフト削除）。</Text>
                  </Dialog.Body>
                  <Dialog.Footer>
                    <Dialog.ActionTrigger asChild>
                      <Button variant="outline">Cancel</Button>
                    </Dialog.ActionTrigger>
                    <Button onClick={handleRemoveDataset} disabled={removing} colorPalette="red">
                      {removing ? "Processing..." : "Delete"}
                    </Button>
                  </Dialog.Footer>
                  <Dialog.CloseTrigger asChild>
                    <CloseButton size="sm" />
                  </Dialog.CloseTrigger>
                </Dialog.Content>
              </Dialog.Positioner>
            </Portal>
          </Dialog.Root>
        </Box>
      </HStack>

      {/* Mobile/Tablet filters (above list, collapsible) */}
      <Box display={{ base: "block", lg: "none" }} mb={4}>
        <Accordion.Root multiple defaultValue={[]}> 
          <Accordion.Item value="label">
            <Accordion.ItemTrigger>
              <HStack justify="space-between" w="full">
                <Text fontWeight="bold">Label Type</Text>
                <Accordion.ItemIndicator />
              </HStack>
            </Accordion.ItemTrigger>
            <Accordion.ItemContent>
              <Accordion.ItemBody>
                <LabelFilterControls showLegend={false} />
              </Accordion.ItemBody>
            </Accordion.ItemContent>
          </Accordion.Item>
          <Accordion.Item value="media">
            <Accordion.ItemTrigger>
              <HStack justify="space-between" w="full">
                <Text fontWeight="bold">Media Type</Text>
                <Accordion.ItemIndicator />
              </HStack>
            </Accordion.ItemTrigger>
            <Accordion.ItemContent>
              <Accordion.ItemBody>
                <MediaFilterControls showLegend={false} />
              </Accordion.ItemBody>
            </Accordion.ItemContent>
          </Accordion.Item>
        </Accordion.Root>
      </Box>

      <Flex align="flex-start">
        {/* Desktop sidebar filters */}
        <VStack align="start" w="25%" gap="10px" display={{ base: "none", lg: "flex" }}>
          <LabelFilterControls />
          <MediaFilterControls />
        </VStack>

        <Box flex="1" ml={{ base: 0, lg: 8 }}>
          {isError && (
            <HStack color="red.500" justify="space-between" mb="2">
              <Box>Failed to load files: {String((error as any)?.message ?? error)}</Box>
              <Button size="xs" variant="outline" onClick={() => refetch()}>Retry</Button>
            </HStack>
          )}
          <SimpleGrid columns={GRID_COLUMNS} gap="10px">
            {isPending ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Box key={i} bg="white" width="200px" pb="8px" rounded="md" borderWidth="1px" overflow="hidden">
                  <Skeleton height="200px" />
                  <Box px="8px" pt="6px">
                    <SkeletonText noOfLines={1} />
                  </Box>
                </Box>
              ))
            ) : (
            pageFiles.map((f) => {
              const isImage = (f.mime || "").startsWith("image/");
              const isVideoWithThumb = (f.mime || "").startsWith("video/") && !!f.thumbKey;
              const url = (isImage || isVideoWithThumb) ? imgUrls[f.key] : undefined;
              const mParam = encodeURIComponent(selectedMedia.join(","));
              const lb = encodeURIComponent(labelFilter["Bounding Box"]); // any|has|no
              const lo = encodeURIComponent(labelFilter["OneShotBBox"]); // any|has|no
              const href = `/dataset/opened-dataset/object-card?d=${encodeBase64Utf8(datasetName)}&id=${encodeBase64Utf8(f.id)}&n=${encodeBase64Utf8(f.name || f.key)}&b=${encodeBase64Utf8(f.bucket)}&k=${encodeBase64Utf8(f.key)}&m=${mParam}&lb=${lb}&lo=${lo}`;
              // Determine clickability based on encode job status
              let clickable = false;
              let overlayText: string | null = null;

              // Images are always openable regardless of encode status
              if (isImage) {
                clickable = true;
                overlayText = null;
              } else if ((f.encode || "") === "video-merge" && mergeInfo && Array.isArray(mergeInfo.members) && mergeInfo.members.length > 0) {
                // All member videos must be complete
                const memberFiles: FileRow[] = mergeInfo.members
                  .map((nm: string) => filesByName[nm])
                  .filter(Boolean);
                const allComplete = memberFiles.length > 0 && memberFiles.every((mf) => hlsStatusMap[mf.id] === "complete");
                clickable = allComplete;
                if (!allComplete) overlayText = t("encode.waitingMerge", "Encoding...");
              } else {
                const st: HlsStatus | undefined = hlsStatusMap[f.id];
                clickable = st === "complete";
                if (!clickable) {
                  if (st === "queued") {
                    overlayText = t("encode.queued", "Queued");
                  } else if (st === "in_progress") {
                    overlayText = t("encode.inProgress", "Encoding...");
                  } else {
                    overlayText = t("encode.none", "Not encoded");
                  }
                }
              }

              const Card = (
                <Box bg="white" width="200px" pb="8px" rounded="md" borderWidth="1px" overflow="hidden" opacity={clickable ? 1 : 0.8} cursor={clickable ? "pointer" : "not-allowed"}>
                  <Box bg="bg.subtle" style={{ aspectRatio: 1 as any }} position="relative" aria-busy={!url} userSelect="none">
                    {url && (
                      <Image src={url} alt={f.name} objectFit="cover" w="100%" h="100%" />
                    )}
                    {!url && (
                      <Box pos="absolute" inset="0" bg="bg/80">
                        <Center h="full">
                          <Spinner color="teal.500" />
                        </Center>
                      </Box>
                    )}
                    {(f.encode === "video-merge") && (
                      <Box position="absolute" top="6px" left="6px">
                        <Badge size="sm" colorPalette="purple" variant="solid">{t("merge.badge","Merged")}</Badge>
                      </Box>
                    )}
                    {!clickable && !isImage && (
                      <Box pos="absolute" inset="0" bg="blackAlpha.500">
                        <Center h="full">
                          <HStack gap="2">
                            <Spinner size="sm" color="teal.300" />
                            <Text color="white" fontSize="sm">{overlayText}</Text>
                          </HStack>
                        </Center>
                      </Box>
                    )}
                  </Box>
                  <Box px="8px" pt="6px">
                    <Text fontSize="sm" style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{f.name}</Text>
                  </Box>
                </Box>
              );

              return clickable ? (
                <NextLink key={f.id} href={href}>{Card}</NextLink>
              ) : (
                <Box key={f.id}>{Card}</Box>
              );
              })
            )}
          </SimpleGrid>

          {/* Pagination controls */}
          {!isPending && sortedVisibleFiles.length > 0 && (
            <HStack mt={4} justify="center" gap="4">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={clampedPage <= 0}
              >
                Prev Page
              </Button>
              <Text fontSize="sm">
                {clampedPage * PAGE_SIZE + 1}
                {" - "}
                {Math.min(sortedVisibleFiles.length, (clampedPage + 1) * PAGE_SIZE)}
                {" / "}
                {sortedVisibleFiles.length}
              </Text>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={clampedPage >= totalPages - 1}
              >
                Next Page
              </Button>
            </HStack>
          )}
        </Box>
      </Flex>
    </Box>
  );
}

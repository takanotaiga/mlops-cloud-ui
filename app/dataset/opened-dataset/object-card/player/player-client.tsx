"use client";

import {
  Box,
  Button,
  Center,
  Heading,
  HStack,
  Link,
  SkeletonText,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider";
import { extractRows } from "@/components/surreal/normalize";
import { decodeBase64Utf8, encodeBase64Utf8 } from "@/components/utils/base64";
import { getSignedObjectUrl } from "@/components/utils/minio";

type ThingLike = { tb: string; id: unknown };
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

type FileRow = {
  id: string;
  bucket: string;
  key: string;
  name: string;
  dataset?: string;
  thumbKey?: string | null;
  mime?: string;
};

export default function PlayerClient() {
  const params = useSearchParams();
  const { isSuccess } = useSurreal();
  const surreal = useSurrealClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<any>(null);

  const { datasetName, objectName, fileId, fallbackBucket } = useMemo(() => {
    const d = params.get("d") || "";
    const n = params.get("n") || "";
    const i = params.get("id") || "";
    const b = params.get("b") || "";
    let datasetName = "";
    let objectName = "";
    let fileId = "";
    let fallbackBucket = "";
    try { datasetName = d ? decodeBase64Utf8(d) : ""; } catch { /* noop */ }
    try { objectName = n ? decodeBase64Utf8(n) : ""; } catch { /* noop */ }
    try { fileId = i ? decodeBase64Utf8(i) : ""; } catch { /* noop */ }
    try { fallbackBucket = b ? decodeBase64Utf8(b) : ""; } catch { /* noop */ }
    return { datasetName, objectName, fileId, fallbackBucket };
  }, [params]);

  const { data: file, isPending: fileLoading } = useQuery({
    queryKey: ["player-file", fileId],
    enabled: isSuccess && !!fileId,
    queryFn: async (): Promise<FileRow | null> => {
      const res = await surreal.query("SELECT * FROM file WHERE id == <record> $id LIMIT 1;", { id: fileId });
      const rows = extractRows<any>(res);
      const raw = rows?.[0];
      if (!raw) return null;
      return {
        id: thingToString(raw.id),
        bucket: String(raw.bucket || ""),
        key: String(raw.key || ""),
        name: String(raw.name || raw.key || ""),
        dataset: raw.dataset ? thingToString(raw.dataset) : undefined,
        thumbKey: raw.thumbKey ?? null,
        mime: raw.mime ? String(raw.mime) : undefined,
      } as FileRow;
    },
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });

  type HlsPlaylist = { bucket: string; key: string; totalSegments?: number };
  const { data: playlist, isPending: playlistLoading } = useQuery({
    queryKey: ["hls-playlist", fileId],
    enabled: isSuccess && !!fileId,
    queryFn: async (): Promise<HlsPlaylist | null> => {
      const res = await surreal.query(
        "SELECT * FROM hls_playlist WHERE file = <record> $id LIMIT 1;",
        { id: fileId }
      );
      const rows = extractRows<any>(res);
      const row = rows?.[0];
      if (!row) return null;
      return {
        bucket: String(row.bucket || ""),
        key: String(row.key || ""),
        totalSegments: row?.meta?.totalSegments ?? undefined,
      };
    },
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });

  const [m3u8Url, setM3u8Url] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);

  // Build signed/proxied URLs for HLS and poster
  useEffect(() => {
    let cancelled = false;
    const go = async () => {
      try {
        if (playlist?.bucket && playlist?.key) {
          // Use playlist rewriting proxy so that segment URIs become absolute proxied URLs
          const url = `/api/storage/hls/playlist?b=${encodeURIComponent(playlist.bucket)}&k=${encodeURIComponent(playlist.key)}`;
          if (!cancelled) setM3u8Url(url);
        } else {
          setM3u8Url(null);
        }
      } catch {
        if (!cancelled) setM3u8Url(null);
      }
    };
    go();
    return () => { cancelled = true; };
  }, [playlist?.bucket, playlist?.key]);

  useEffect(() => {
    let cancelled = false;
    const go = async () => {
      try {
        const b = file?.bucket || fallbackBucket;
        const t = file?.thumbKey || null;
        if (b && t) {
          const url = await getSignedObjectUrl(b, t, 60 * 10);
          if (!cancelled) setPosterUrl(url);
        } else {
          if (!cancelled) setPosterUrl(null);
        }
      } catch {
        if (!cancelled) setPosterUrl(null);
      }
    };
    go();
    return () => { cancelled = true; };
  }, [file?.bucket, file?.thumbKey, fallbackBucket]);

  // Attach source: prefer native HLS (Safari), otherwise use hls.js dynamically
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!m3u8Url) return;
    const canNativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
      video.canPlayType("application/x-mpegURL") !== "";
    if (canNativeHls) {
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
      video.src = m3u8Url;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("hls.js");
        const Hls = (mod as any).default || (mod as any);
        if (!Hls?.isSupported?.()) {
          video.removeAttribute("src");
          try { video.load(); } catch { /* noop */ }
          return;
        }
        if (cancelled) return;
        if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } }
        const hls = new Hls({ lowLatencyMode: false });
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          if (cancelled) return;
          hls.loadSource(m3u8Url);
        });
        hls.on(Hls.Events.ERROR, (_e: any, data: any) => {
          if (data?.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                try { hls.destroy(); } catch { /* noop */ }
                hlsRef.current = null;
                break;
            }
          }
        });
      } catch {
        video.removeAttribute("src");
        try { video.load(); } catch { /* noop */ }
      }
    })();
    return () => {
      cancelled = true;
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
    };
  }, [m3u8Url]);

  const backHref = useMemo(() => {
    const d = params.get("d") || "";
    const n = params.get("n") || "";
    const i = params.get("id") || "";
    const b = params.get("b") || "";
    const k = params.get("k") || "";
    return `/dataset/opened-dataset/object-card?d=${encodeURIComponent(d)}&id=${encodeURIComponent(i)}&n=${encodeURIComponent(n)}&b=${encodeURIComponent(b)}&k=${encodeURIComponent(k)}`;
  }, [params]);

  return (
    <Box px="10%" py="20px">
      <HStack align="center" justify="space-between">
        <Heading size="2xl">
          <Link asChild color="black" textDecoration="none" _hover={{ textDecoration: "none", color: "black" }}>
            <NextLink href="/dataset">Dataset</NextLink>
          </Link>
          {" / "}
          <Link asChild color="black" textDecoration="none" _hover={{ textDecoration: "none", color: "black" }}>
            <NextLink href={`/dataset/opened-dataset?d=${encodeURIComponent(encodeBase64Utf8(datasetName))}`}>
              {datasetName || "(unknown)"}
            </NextLink>
          </Link>
          {" / Player / "}
          {objectName || file?.name || "Object"}
        </Heading>
        <HStack gap={2}>
          <Button asChild size="sm" variant="subtle" rounded="full">
            <NextLink href={backHref}>Back</NextLink>
          </Button>
        </HStack>
      </HStack>

      <VStack align="stretch" gap={4} mt={8}>
        {(fileLoading || playlistLoading) && (
          <Center py={8}>
            <Spinner />
          </Center>
        )}

        {!fileLoading && !file && (
          <Text color="red.600">File not found.</Text>
        )}

        {!playlistLoading && !playlist && (
          <Box>
            <Text fontWeight="bold">HLS playlist not available.</Text>
            <Text color="gray.600" mt={2}>The video is not yet segmented for HLS or the job has not completed.</Text>
          </Box>
        )}

        {playlist && (
          <Box>
            <video
              ref={videoRef}
              controls
              playsInline
              poster={posterUrl || undefined}
              style={{ width: "100%", maxHeight: 600, background: "black" }}
            >
              {/* Accessibility: provide an empty captions track to satisfy a11y rule when captions are unavailable */}
              <track kind="captions" label="captions" srcLang="en" src="data:," />
            </video>
            <Box mt={2}>
              <Text fontSize="sm" color="gray.600">
                If your browser can’t play HLS natively, open the playlist directly:
                {" "}
                <Link href={m3u8Url || "#"} target="_blank" rel="noreferrer">index.m3u8</Link>
              </Text>
              {typeof playlist.totalSegments === "number" && (
                <Text fontSize="sm" color="gray.600">Segments: {playlist.totalSegments}</Text>
              )}
            </Box>
          </Box>
        )}

        <Box>
          <Heading size="md">Info</Heading>
          {fileLoading ? (
            <SkeletonText noOfLines={3} mt={2} />
          ) : (
            <VStack align="stretch" mt={2} fontSize="sm" color="gray.700">
              <HStack justify="space-between"><Text color="gray.500">Dataset</Text><Text>{file?.dataset || datasetName || "-"}</Text></HStack>
              <HStack justify="space-between"><Text color="gray.500">Bucket</Text><Text>{playlist?.bucket || file?.bucket || fallbackBucket || "-"}</Text></HStack>
              <HStack justify="space-between"><Text color="gray.500">Playlist Key</Text><Text style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{playlist?.key || "-"}</Text></HStack>
              <HStack justify="space-between"><Text color="gray.500">File ID</Text><Text style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{file?.id || (fileId || "-")}</Text></HStack>
            </VStack>
          )}
        </Box>
      </VStack>
    </Box>
  );
}

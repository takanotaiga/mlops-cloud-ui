"use client";

import { Box, Heading, HStack, VStack, Text, Button, Badge, Link, SkeletonText, Skeleton, Dialog, Portal, CloseButton, Progress, ButtonGroup, IconButton, Pagination, Table, Separator, Steps, Accordion } from "@chakra-ui/react";
import NextLink from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { decodeBase64Utf8 } from "@/components/utils/base64";
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { extractRows } from "@/components/surreal/normalize";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { getSignedObjectUrl } from "@/components/utils/minio";
import { cacheExists, downloadAndCacheBytes, readCachedBytes } from "@/components/utils/storage-cache";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";

type JobRow = {
  id: string
  name: string
  status?: string
  taskType?: string
  model?: string
  modelSource?: string
  datasets?: string[]
  createdAt?: string
  updatedAt?: string
}

type ProgressStep = { key: string; label?: string; state?: "pending" | "running" | "completed" | "failed" }
type JobProgress = { current_key?: string | null; steps?: ProgressStep[] }

type InferenceResultRow = {
  id: string
  bucket: string
  key: string
  size?: number
  createdAt?: string
  mime?: string
  meta?: any
}

function thingToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "tb" in (v as any) && "id" in (v as any)) {
    const t = v as any;
    const id = typeof t.id === "object" && t.id !== null ? ((t.id as any).toString?.() ?? JSON.stringify(t.id)) : String(t.id);
    return `${t.tb}:${id}`;
  }
  return String(v);
}

export default function ClientOpenedInferenceJobPage() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const jobName = useMemo(() => {
    const j = params.get("j");
    if (!j) return "";
    try { return decodeBase64Utf8(j); } catch { return ""; }
  }, [params]);

  const surreal = useSurrealClient();
  const { isSuccess } = useSurreal();
  const [removing, setRemoving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [downloadPct, setDownloadPct] = useState<number>(0);
  const [checkingParquetLocal, setCheckingParquetLocal] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<any>(null);

  const { data: job, isPending, isError, error, refetch } = useQuery({
    queryKey: ["inference-job-detail", jobName],
    enabled: isSuccess && !!jobName,
    queryFn: async (): Promise<JobRow | null> => {
      const res = await surreal.query("SELECT * FROM inference_job WHERE name == $name ORDER BY updatedAt DESC LIMIT 1", { name: jobName });
      const rows = extractRows<any>(res);
      const r = rows[0];
      if (!r) return null;
      return {
        id: thingToString(r?.id),
        name: String(r?.name ?? ""),
        status: r?.status,
        taskType: r?.taskType,
        model: r?.model,
        modelSource: r?.modelSource,
        datasets: Array.isArray(r?.datasets) ? r.datasets : [],
        createdAt: r?.createdAt,
        updatedAt: r?.updatedAt,
      };
    },
    refetchOnWindowFocus: false,
    staleTime: 2000,
    // Poll every 3s until job reaches a terminal state
    refetchInterval: (q: any) => {
      const j = q?.state?.data as JobRow | null | undefined;
      const s = (j?.status || "").toLowerCase();
      const isTerminal = s === "complete" || s === "completed" || s === "failed" || s === "faild";
      return isTerminal ? false : 3000;
    },
  });

  // Poll job progress (step-based) at short intervals
  const { data: progress = { current_key: null, steps: [] } as JobProgress } = useQuery({
    queryKey: ["inference-job-progress", jobName],
    enabled: isSuccess && !!jobName,
    queryFn: async (): Promise<JobProgress> => {
      const res = await surreal.query(
        "SELECT progress FROM inference_job WHERE name == $name LIMIT 1",
        { name: jobName }
      );
      const rows = extractRows<any>(res);
      const r = rows[0] || {};
      const p = (r?.progress ?? {}) as JobProgress;
      // Normalize shape defensively
      const steps: ProgressStep[] = Array.isArray(p?.steps) ? p.steps.map((s: any) => ({
        key: String(s?.key ?? ""),
        label: s?.label ? String(s.label) : undefined,
        state: (s?.state ?? "pending") as any,
      })).filter((s) => s.key) : [];
      return { current_key: p?.current_key ?? null, steps };
    },
    refetchOnWindowFocus: false,
    refetchInterval: 800,
    staleTime: 0,
  });

  const procSteps = useMemo(() => (progress?.steps ?? []).map((s) => ({ id: String(s.key), title: String(s.label ?? s.key), state: (s.state ?? "pending") as "pending" | "running" | "completed" | "failed" })), [progress?.steps]);
  const currentStepId: string | null | undefined = progress?.current_key ?? null;
  const allCompleted = useMemo(() => procSteps.length > 0 && procSteps.every((s) => (s.state ?? "pending") === "completed"), [procSteps]);
  const firstFailedIndex = useMemo(() => procSteps.findIndex((s) => (s.state ?? "pending") === "failed"), [procSteps]);
  const activeIndex = useMemo(() => {
    if (typeof firstFailedIndex === "number" && firstFailedIndex >= 0) return firstFailedIndex;
    if (currentStepId) {
      const idx = procSteps.findIndex((s) => s.id === currentStepId || s.state === "running");
      if (idx >= 0) return idx;
    }
    // fallback to last completed + 1
    let lastCompleted = -1;
    procSteps.forEach((s, i) => { if ((s.state ?? "pending") === "completed") lastCompleted = i; });
    return Math.min(procSteps.length - 1, Math.max(0, lastCompleted + 1));
  }, [procSteps, currentStepId, firstFailedIndex]);

  // Query inference results for this job when completed and task matches (newest first)
  const { data: results = [] } = useQuery({
    queryKey: ["inference-result", job?.id],
    enabled: isSuccess && !!job?.id && (job?.status === "Complete" || job?.status === "Completed") && job?.taskType === "one-shot-object-detection",
    queryFn: async (): Promise<InferenceResultRow[]> => {
      if (!job?.id) return [];
      const res = await surreal.query("SELECT * FROM inference_result WHERE job == <record> $job ORDER BY createdAt DESC", { job: job.id });
      const rows = extractRows<any>(res);
      return rows.map((r: any) => ({
        id: thingToString(r?.id),
        bucket: String(r?.bucket),
        key: String(r?.key),
        size: Number(r?.size ?? 0),
        createdAt: r?.createdAt,
        mime: r?.mime ? String(r.mime) : undefined,
        meta: r?.meta,
      })) as InferenceResultRow[];
    },
    refetchOnWindowFocus: false,
    staleTime: 5_000,
  });

  // Selection state for results
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);
  const current = useMemo(() => (results && results.length > 0 ? results[Math.min(results.length - 1, Math.max(0, selectedIndex))] : undefined), [results, selectedIndex]);

  // Ungrouped results list (already ordered by createdAt DESC)

  // Classification helpers
  function getExt(name?: string) {
    if (!name) return "";
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
  }
  function isVideoResult(r?: InferenceResultRow): boolean {
    if (!r) return false;
    const m = (r.mime || "").toLowerCase();
    if (m.startsWith("video/")) return true;
    const ext = getExt(r.key);
    return /^(mp4|mov|mkv|avi|webm)$/i.test(ext);
  }
  function isJsonResult(r?: InferenceResultRow): boolean {
    if (!r) return false;
    const m = (r.mime || "").toLowerCase();
    if (m === "application/json" || m.endsWith("+json")) return true;
    const ext = getExt(r.key);
    return ext === "json";
  }
  function isParquetResult(r?: InferenceResultRow): boolean {
    if (!r) return false;
    const m = (r.mime || "").toLowerCase();
    if (m === "application/parquet" || m === "application/x-parquet") return true;
    const ext = getExt(r.key);
    return ext === "parquet";
  }

  // HLS playlist for current video result
  type HlsPlaylist = { bucket: string; key: string; totalSegments?: number };
  const { data: playlist, isPending: playlistLoading } = useQuery({
    queryKey: ["hls-playlist-inference", current?.id],
    enabled: isSuccess && !!current?.id && isVideoResult(current),
    queryFn: async (): Promise<HlsPlaylist | null> => {
      if (!current?.id) return null;
      const res = await surreal.query(
        "SELECT * FROM hls_playlist WHERE file = <record> $id LIMIT 1;",
        { id: current.id }
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

  // Build proxied m3u8 URL
  const m3u8Url = useMemo(() => {
    if (!playlist?.bucket || !playlist?.key) return null;
    return `/api/storage/hls/playlist?b=${encodeURIComponent(playlist.bucket)}&k=${encodeURIComponent(playlist.key)}`;
  }, [playlist?.bucket, playlist?.key]);

  // Attach source: native HLS or hls.js
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
    const cancelled = false;
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
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
    };
  }, [m3u8Url]);

  // For parquet: check OPFS cache presence when selected and auto-download if missing
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!current?.key || !(job && (job.status === "Complete" || job.status === "Completed") && job.taskType === "one-shot-object-detection")) return;
      if (!isParquetResult(current)) return;
      setCheckingParquetLocal(true);
      try {
        const exists = await cacheExists(current.bucket, current.key);
        // no UI indicator; just proceed
        if (!exists && !downloading) {
          try {
            setDownloading(true);
            setDownloadPct(0);
            await downloadAndCacheBytes(current.bucket, current.key);
            setDownloadPct(100);
          } catch { /* ignore */ }
          finally { setDownloading(false); }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setCheckingParquetLocal(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [current?.key, job?.status, job?.taskType]);

  function formatTimestamp(ts?: string): string {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // removed minute grouping helper

  async function handleRemove() {
    if (!jobName || removing) return;
    setRemoving(true);
    try {
      // Soft-delete: mark this inference job as dead. Do not delete S3 or other tables.
      await surreal.query(
        "UPDATE inference_job SET dead = true, updatedAt = time::now() WHERE name == $name",
        { name: jobName }
      );
      // Invalidate job list and navigate with refresh token to force reload
      queryClient.invalidateQueries({ queryKey: ["inference-jobs"] });
      const r = Date.now().toString();
      router.push(`/inference?r=${encodeURIComponent(r)}`);
    } catch {
      // ignore
    } finally {
      setRemoving(false);
    }
  }

  // JSON loader for current item
  const { data: jsonData, isPending: jsonLoading, isError: jsonError, refetch: refetchJson } = useQuery({
    queryKey: ["inference-result-json", current?.id],
    enabled: !!current && isJsonResult(current),
    queryFn: async (): Promise<any> => {
      if (!current) return null;
      const url = await getSignedObjectUrl(current.bucket, current.key, 60 * 10);
      const resp = await fetch(url);
      const text = await resp.text();
      try { return JSON.parse(text); } catch { return { _raw: text }; }
    },
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });

  // Generic direct download
  async function downloadDirect(bucket: string, key: string) {
    const url = await getSignedObjectUrl(bucket, key, 60 * 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = key.split("/").pop() || "download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // JSON syntax highlighting (lightweight)
  function highlightJsonToNodes(text: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    const regex = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"\s*:)|("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      const i = m.index;
      const match = m[0];
      if (i > lastIndex) nodes.push(text.slice(lastIndex, i));
      let color = "#2D3748"; // gray.700
      if (m[1]) {
        // Key (string followed by colon)
        color = "#3182CE"; // blue.600
      } else if (m[2]) {
        // String value
        color = "#38A169"; // green.500
      } else if (m[3]) {
        // true/false/null
        color = "#DD6B20"; // orange.500
      } else if (/^-?\d/.test(match)) {
        color = "#805AD5"; // purple.500
      }
      nodes.push(<span style={{ color }} key={`tok-${i}`}>{match}</span>);
      lastIndex = i + match.length;
    }
    if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
    return nodes;
  }

  // Parquet table state and loader (via duckdb-wasm from CDN)
  const PAGE_SIZE = 50;
  const [tablePage, setTablePage] = useState<number>(1);
  useEffect(() => { setTablePage(1); }, [current?.id]);
  const [pqCols, setPqCols] = useState<string[]>([]);
  const [pqRows, setPqRows] = useState<any[]>([]);
  const [pqTotal, setPqTotal] = useState<number>(0);
  const [pqLoading, setPqLoading] = useState<boolean>(false);
  const [pqError, setPqError] = useState<string | null>(null);

  async function queryParquetPage(url: string, page: number, bucketForCache?: string, keyForCache?: string) {
    setPqLoading(true);
    setPqError(null);
    try {
      // dynamic import duckdb-wasm from jsDelivr
      const importer = new Function("u", "return import(u)") as (u: string) => Promise<any>;
      let mod: any;
      try {
        mod = await importer("https://esm.sh/@duckdb/duckdb-wasm@1.28.0/dist/duckdb-browser.mjs");
      } catch {
        mod = await importer("https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/dist/duckdb-browser.mjs");
      }
      const bundles = mod.getJsDelivrBundles();
      // Prefer the MVP (single-thread) bundle to avoid COOP/COEP and pthread issues
      const bundle = (bundles && (bundles.mvp || bundles.standalone || bundles["mvp"])) || (await mod.selectBundle(bundles));
      const workerUrl = bundle.mainWorker || bundle.worker;
      let worker: Worker;
      try {
        // Try same-origin blob worker by fetching the script and creating a blob URL
        const resp = await fetch(workerUrl, { mode: "cors" });
        const scriptText = await resp.text();
        const blobUrl = URL.createObjectURL(new Blob([scriptText], { type: "text/javascript" }));
        worker = new Worker(blobUrl);
      } catch {
        // Fallback to direct URL (may fail due to cross-origin restrictions)
        worker = new Worker(workerUrl);
      }
      const logger = new mod.ConsoleLogger();
      const db = new mod.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();
      // Acquire parquet bytes either from cache (OPFS/CacheAPI) or fetch
      let fileBuf: Uint8Array;
      if (bucketForCache && keyForCache && (await cacheExists(bucketForCache, keyForCache))) {
        fileBuf = (await readCachedBytes(bucketForCache, keyForCache)) || new Uint8Array(0);
        if (!fileBuf || fileBuf.length === 0) {
          const fileResp = await fetch(url);
          fileBuf = new Uint8Array(await fileResp.arrayBuffer());
        }
      } else {
        const fileResp = await fetch(url);
        fileBuf = new Uint8Array(await fileResp.arrayBuffer());
      }
      await db.registerFileBuffer("current.parquet", fileBuf);
      const offset = (page - 1) * PAGE_SIZE;
      const countRes: any = await conn.query("SELECT COUNT(*) AS c FROM read_parquet('current.parquet')");
      const total = Number((countRes as any)?.toArray?.()[0]?.c ?? 0);
      setPqTotal(total);
      const res: any = await conn.query(`SELECT * FROM read_parquet('current.parquet') LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
      // Extract columns and rows
      const rows: any[] = (res as any)?.toArray?.() ?? [];
      const cols: string[] = (res as any)?.schema?.fields?.map((f: any) => String(f.name)) ?? (rows[0] ? Object.keys(rows[0]) : []);
      setPqCols(cols);
      setPqRows(rows);
      await conn.close();
      await db.terminate();
    } catch (e: any) {
      const msg = (e && (e.message || (typeof e === "string" ? e : e?.toString?.()))) || String(e);
      setPqError(String(msg));
    } finally {
      setPqLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!current || !isParquetResult(current)) return;
      try {
        const url = await getSignedObjectUrl(current.bucket, current.key, 60 * 10);
        if (!cancelled) await queryParquetPage(url, tablePage, current.bucket, current.key);
      } catch (e: any) {
        if (!cancelled) setPqError(String(e?.message || e));
      }
    }
    run();
    return () => { cancelled = true; };
  }, [current?.id, tablePage]);

  return (
    <Box px="10%" py="20px">
      <HStack align="center" justify="space-between">
        <HStack gap="3" align="center">
          <Heading size="2xl">
            <Link asChild color="black" _hover={{ textDecoration: "none", color: "black" }}>
              <NextLink href="/inference">{t("inference.detail.breadcrumb", "Inference 🤖")}</NextLink>
            </Link>
            {" / "}
            {jobName || "(unknown)"}
          </Heading>
          <Badge rounded="full" variant="subtle" colorPalette="teal">{t("inference.badge", "Inference")}</Badge>
        </HStack>
        <HStack>
          {job?.status === "ProcessWaiting" && (
            <Button size="sm" rounded="full" variant="outline" onClick={async () => {
              if (!jobName) return;
              try {
                await surreal.query("UPDATE inference_job SET status = 'StopInterrept', updatedAt = time::now() WHERE name == $name", { name: jobName });
                queryClient.invalidateQueries({ queryKey: ["inference-jobs"] });
                refetch();
              } catch { void 0; }
            }}>{t("common.stop", "Stop")}</Button>
          )}
          {job && job.status !== "ProcessWaiting" && (
            (job.status === "StopInterrept" || job.status === "Complete" || job.status === "Completed" || job.status === "Failed" || job.status === "Faild" || job.status === "Error")
          ) && (
              <Button size="sm" rounded="full" variant="outline" disabled={copying} onClick={async () => {
                if (!jobName || !job) return;
                setCopying(true);
                try {
                  // Build new job name: currentName + _copy
                  const newName = `${jobName}_copy`;
                  // Create a new job with the same parameters (taskType/model/datasets), fresh status/time
                  await surreal.query(
                    "CREATE inference_job SET name = $name, status = 'ProcessWaiting', taskType = $taskType, model = $model, modelSource = $modelSource, datasets = $datasets, createdAt = time::now(), updatedAt = time::now()",
                    { name: newName, taskType: job.taskType, model: job.model, modelSource: job.modelSource, datasets: job.datasets || [] }
                  );
                  queryClient.invalidateQueries({ queryKey: ["inference-jobs"] });
                  const enc = (s: string) => {
                    try { return btoa(unescape(encodeURIComponent(s))); } catch { return ""; }
                  };
                  router.push(`/inference/opened-job?j=${encodeURIComponent(enc(newName))}`);
                } catch { /* ignore */ }
                finally { setCopying(false); }
              }}>CopyJob</Button>
            )}
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Button size="sm" rounded="full" colorPalette="red" disabled={removing}>{t("common.remove_job", "Remove Job")}</Button>
            </Dialog.Trigger>
            <Portal>
              <Dialog.Backdrop />
              <Dialog.Positioner>
                <Dialog.Content>
                  <Dialog.Header>
                    <Dialog.Title>Remove Inference Job</Dialog.Title>
                  </Dialog.Header>
                  <Dialog.Body>
                    <Text>ジョブ「{jobName}」を削除します。よろしいですか？</Text>
                  </Dialog.Body>
                  <Dialog.Footer>
                    <Dialog.ActionTrigger asChild>
                      <Button variant="outline">{t("common.cancel", "Cancel")}</Button>
                    </Dialog.ActionTrigger>
                    <Button colorPalette="red" onClick={handleRemove} disabled={removing}>{t("common.remove", "Remove")}</Button>
                  </Dialog.Footer>
                  <Dialog.CloseTrigger asChild>
                    <CloseButton size="sm" />
                  </Dialog.CloseTrigger>
                </Dialog.Content>
              </Dialog.Positioner>
            </Portal>
          </Dialog.Root>
        </HStack>
      </HStack>

      <HStack align="flex-start" gap="16px" mt="16px">
        <Box w={{ base: "100%", md: "420px" }} flexShrink={0} rounded="md" borderWidth="1px" bg="bg.panel" p="16px">
          {isPending ? (
            <>
              <SkeletonText noOfLines={1} w="30%" />
              <Skeleton mt="2" h="14px" w="40%" />
              <Skeleton mt="2" h="14px" w="50%" />
            </>
          ) : isError ? (
            <HStack color="red.500" justify="space-between">
              <Box>Failed to load job: {String((error as any)?.message ?? error)}</Box>
              <Button size="xs" variant="outline" onClick={() => refetch()}>Retry</Button>
            </HStack>
          ) : !job ? (
            <Text color="gray.500">Job not found</Text>
          ) : (
            <VStack align="stretch" gap="8px">
              <HStack justify="space-between">
                <HStack gap="3">
                  <Heading size="lg">{job.name}</Heading>
                  <Badge
                    colorPalette={
                      job.status === "ProcessWaiting"
                        ? "green"
                        : (job.status === "StopInterrept" || job.status === "Failed" || job.status === "Faild")
                          ? "red"
                          : (job.status === "Complete" || job.status === "Completed")
                            ? "blue"
                            : "gray"
                    }
                  >
                    {job.status || "Idle"}
                  </Badge>
                </HStack>
              </HStack>
              <Text textStyle="sm" color="gray.700">Task: {job.taskType || "-"}</Text>
              <Text textStyle="sm" color="gray.700">Model: {job.model || "-"}</Text>
              <Box>
                <Text textStyle="sm" color="gray.700" fontWeight="bold">Datasets</Text>
                {(!job.datasets || job.datasets.length === 0) ? (
                  <Text textStyle="sm" color="gray.500">(none)</Text>
                ) : (
                  <VStack align="start" gap="1" mt="1">
                    {job.datasets.map((d) => (
                      <Text key={d} textStyle="sm">• {d}</Text>
                    ))}
                  </VStack>
                )}
              </Box>
              <Text textStyle="xs" color="gray.500">Created: {formatTimestamp(job.createdAt)}</Text>
              <Text textStyle="xs" color="gray.500">Updated: {formatTimestamp(job.updatedAt)}</Text>

              {/* Progress: placed under info on the left */}
              {procSteps.length > 0 && (
                <Accordion.Root multiple defaultValue={((job?.status === "Complete" || job?.status === "Completed") ? [] : ["progress"]) }>
                  <Accordion.Item value="progress">
                    <Accordion.ItemTrigger>
                      <HStack justify="space-between" w="full">
                        <Heading size="sm">Progress</Heading>
                        <Accordion.ItemIndicator />
                      </HStack>
                    </Accordion.ItemTrigger>
                    <Accordion.ItemContent>
                      <Accordion.ItemBody>
                        <Box rounded="md" borderWidth="1px" p="12px" minH="300px" maxH="70vh" overflowY="auto" bg="bg.canvas">
                          <Steps.Root orientation="vertical" count={procSteps.length} step={(allCompleted ? procSteps.length : activeIndex)}>
                            <Steps.List gap="4">
                              {procSteps.map((s, index) => {
                                const derivedStatus: "pending" | "running" | "completed" | "failed" =
                                  s.id === currentStepId && s.state !== "completed" ? "running" : (s.state ?? "pending");
                                return (
                                  <Steps.Item key={s.id} index={index} title={s.title} py="3">
                                    <Steps.Indicator />
                                    <Steps.Title>{s.title}</Steps.Title>
                                    <Steps.Separator my="3" borderLeftWidth="2px" borderColor="gray.300" opacity={1} />
                                    <Steps.Content index={index}>
                                      <VStack align="stretch" gap={3} mt={3} mb={6} w="full">
                                        <HStack justify="space-between">
                                          <Badge rounded="full" variant="subtle" colorPalette={
                                            derivedStatus === "running" ? "blue" : derivedStatus === "completed" ? "green" : derivedStatus === "failed" ? "red" : "gray"
                                          }>
                                            {derivedStatus}
                                          </Badge>
                                        </HStack>
                                      </VStack>
                                    </Steps.Content>
                                  </Steps.Item>
                                );
                              })}
                            </Steps.List>
                            <Steps.CompletedContent>All steps are complete!</Steps.CompletedContent>
                          </Steps.Root>
                        </Box>
                      </Accordion.ItemBody>
                    </Accordion.ItemContent>
                  </Accordion.Item>
                </Accordion.Root>
              )}

              {/* Results list (flat) */}
              {(job.status === "Complete" || job.status === "Completed") && job.taskType === "one-shot-object-detection" && (
                <VStack align="stretch" gap="8px" mt="8px">
                  <Separator />
                  <Heading size="sm">Results</Heading>
                  {(!results || results.length === 0) ? (
                    <Text textStyle="sm" color="gray.600">Result not ready yet.</Text>
                  ) : (
                    <VStack align="stretch" gap="8px" maxH="500px" overflowY="auto" style={{ scrollbarGutter: "stable both-edges" }}>
                      {results.map((r, idx) => {
                        const name = r.key.split("/").pop() || r.key;
                        const type = isVideoResult(r) ? "Video" : isJsonResult(r) ? "JSON" : isParquetResult(r) ? "Parquet" : "File";
                        const description = r?.meta?.description ? String(r.meta.description) : "";
                        const selected = idx === selectedIndex;
                        return (
                          <Box
                            key={r.id}
                            as="button"
                            onClick={() => { setSelectedIndex(idx); setTablePage(1); }}
                            textAlign="left"
                            rounded="md"
                            borderWidth="1px"
                            p="10px"
                            bg={selected ? "teal.50" : "white"}
                            borderColor={selected ? "teal.300" : "gray.200"}
                            _hover={{ shadow: "sm", borderColor: selected ? "teal.400" : "gray.300" }}
                          >
                            <VStack align="stretch" gap={1}>
                              <Text textStyle="sm" fontWeight="semibold" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</Text>
                              {description ? (
                                <Text textStyle="xs" color="gray.700"
                                  style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                  {description}
                                </Text>
                              ) : null}
                              <HStack justify="space-between" mt={description ? 1 : 0}>
                                <Badge
                                  rounded="full"
                                  variant="subtle"
                                  colorPalette={type === "Video" ? "teal" : type === "JSON" ? "purple" : type === "Parquet" ? "blue" : "gray"}
                                >
                                  {type}
                                </Badge>
                                <Text textStyle="xs" color="gray.600">{formatTimestamp(r.createdAt)}</Text>
                              </HStack>
                            </VStack>
                          </Box>
                        );
                      })}
                    </VStack>
                  )}
                </VStack>
              )}
            </VStack>
          )}
        </Box>

        <Box flex="1" rounded="md" borderWidth="1px" bg="bg.panel" p="16px" minH="240px">

          {job && (job.status === "Complete" || job.status === "Completed") && job.taskType === "one-shot-object-detection" ? (
            <VStack align="stretch" gap={3}>
              {(!results || results.length === 0) ? (
                <Text color="gray.600">Result not ready yet.</Text>
              ) : (
                <>
                  {/* Top action bar: Download / Copy JSON */}
                  <HStack justify="flex-end" mb="8px" gap="8px">
                    {current ? (
                      <>
                        {isJsonResult(current) && (
                          <Button size="sm" rounded="full" variant="outline" onClick={async () => {
                            try {
                              // Ensure we have jsonData loaded, otherwise fetch then copy
                              if (!jsonData) {
                                await refetchJson();
                              }
                              const text = (jsonData && jsonData._raw) ? String(jsonData._raw) : JSON.stringify(jsonData ?? {}, null, 2);
                              await navigator.clipboard.writeText(text);
                            } catch { /* ignore */ }
                          }} disabled={jsonLoading || !!jsonError}>Copy JSON</Button>
                        )}
                        {!isParquetResult(current) && (
                          <Button size="sm" rounded="full" onClick={() => downloadDirect(current.bucket, current.key)}>
                            Download
                          </Button>
                        )}
                      </>
                    ) : null}
                  </HStack>
                  {/* Current Result */}
                  {current && isVideoResult(current) ? (
                    <>
                      {playlistLoading ? (
                        <Text textStyle="sm" color="gray.600">Loading player...</Text>
                      ) : !playlist ? (
                        <Box>
                          <Text fontWeight="bold">HLS playlist not available.</Text>
                          <Text textStyle="sm" color="gray.600" mt={1}>The video is not yet segmented or unavailable.</Text>
                        </Box>
                      ) : (
                        <Box>
                          <video
                            ref={videoRef}
                            controls
                            playsInline
                            style={{ width: "100%", maxHeight: "70vh", background: "black" }}
                          >
                            <track kind="captions" label="captions" srcLang="en" src="data:," />
                          </video>
                        </Box>
                      )}
                    </>
                  ) : current && isJsonResult(current) ? (
                    <>
                      {jsonLoading ? (
                        <Text textStyle="sm" color="gray.600">Loading JSON...</Text>
                      ) : jsonError ? (
                        <HStack color="red.500" justify="space-between">
                          <Box>Failed to load JSON</Box>
                          <Button size="xs" variant="outline" onClick={() => refetchJson()}>Retry</Button>
                        </HStack>
                      ) : (
                        <Box as="pre" p="12px" bg="gray.50" borderWidth="1px" rounded="md" overflow="auto" maxH="70vh">
                          {(() => {
                            try {
                              const text = jsonData && jsonData._raw ? String(jsonData._raw) : JSON.stringify(jsonData, null, 2);
                              return highlightJsonToNodes(text);
                            } catch {
                              return String(jsonData);
                            }
                          })()}
                        </Box>
                      )}
                      {/* Buttons moved to the top action bar */}
                    </>
                  ) : current && isParquetResult(current) ? (
                    <>
                      {pqError ? (
                        <HStack color="red.500" justify="space-between">
                          <Box>Failed to load table: {pqError}</Box>
                          <Button size="xs" variant="outline" onClick={async () => {
                            if (!current) return;
                            try {
                              const url = await getSignedObjectUrl(current.bucket, current.key, 60 * 10);
                              await queryParquetPage(url, tablePage, current.bucket, current.key);
                            } catch { void 0; }
                          }}>Retry</Button>
                        </HStack>
                      ) : pqLoading ? (
                        <Text textStyle="sm" color="gray.600">Loading table...</Text>
                      ) : (
                        <>
                          {checkingParquetLocal ? (
                            <Text textStyle="xs" color="gray.600">Checking local cache...</Text>
                          ) : null}
                          {downloading && (
                            <Box maxW="360px">
                              <Progress.Root value={downloadPct}>
                                <Progress.Track>
                                  <Progress.Range />
                                </Progress.Track>
                              </Progress.Root>
                              <Text textStyle="xs" color="gray.600" mt={1}>{downloadPct}%</Text>
                            </Box>
                          )}
                          <HStack justify="flex-end" mb="8px" gap="8px">
                            <Button
                              size="sm"
                              rounded="full"
                              onClick={() => {
                                if (!current) return;
                                try {
                                  const j = params.get("j") || "";
                                  const enc = (s: string) => {
                                    try { return btoa(unescape(encodeURIComponent(s))); } catch { return ""; }
                                  };
                                  const qb = enc(current.bucket);
                                  const qk = enc(current.key);
                                  const url = `/inference/opened-job/analysis?j=${encodeURIComponent(j)}&b=${encodeURIComponent(qb)}&k=${encodeURIComponent(qk)}`;
                                  router.push(url);
                                } catch { void 0; }
                              }}
                            >
                              {t("inference.detailed_analysis", "Detailed Analysis")}
                            </Button>
                            <Button size="sm" rounded="full" variant="outline" onClick={() => current && downloadDirect(current.bucket, current.key)}>
                              Download Parquet
                            </Button>
                          </HStack>
                          <Box overflowX="auto" borderWidth="1px" rounded="md">
                            <Table.Root size="sm" variant="outline" striped>
                              <Table.Header>
                                <Table.Row>
                                  {pqCols.map((c) => (
                                    <Table.ColumnHeader key={c}>{c}</Table.ColumnHeader>
                                  ))}
                                </Table.Row>
                              </Table.Header>
                              <Table.Body>
                                {pqRows.map((row, idx) => (
                                  <Table.Row key={idx}>
                                    {pqCols.map((c) => (
                                      <Table.Cell key={c}>{String(row?.[c] ?? "")}</Table.Cell>
                                    ))}
                                  </Table.Row>
                                ))}
                              </Table.Body>
                            </Table.Root>
                          </Box>
                          <Pagination.Root
                            count={pqTotal}
                            pageSize={PAGE_SIZE}
                            page={tablePage}
                            onPageChange={(e: any) => setTablePage(e.page)}
                          >
                            <ButtonGroup variant="ghost" size="sm" wrap="wrap">
                              <Pagination.PrevTrigger asChild>
                                <IconButton aria-label="Prev page">
                                  <LuChevronLeft />
                                </IconButton>
                              </Pagination.PrevTrigger>
                              <Pagination.Items
                                render={(p: any) => (
                                  <IconButton aria-label={`Go to page ${p.value}`} variant={{ base: "ghost", _selected: "outline" }}>
                                    {p.value}
                                  </IconButton>
                                )}
                              />
                              <Pagination.NextTrigger asChild>
                                <IconButton aria-label="Next page">
                                  <LuChevronRight />
                                </IconButton>
                              </Pagination.NextTrigger>
                            </ButtonGroup>
                          </Pagination.Root>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <HStack>
                        <Button size="sm" rounded="full" onClick={() => current && downloadDirect(current.bucket, current.key)}>Download</Button>
                      </HStack>
                    </>
                  )}
                </>
              )}
            </VStack>
          ) : (
            <Text color="gray.500">Inference charts / logs can appear here.</Text>
          )}
        </Box>
      </HStack>
    </Box>
  );
}

"use client";

import { Box, Heading, HStack, VStack, Stack, Text, Button, Badge, Link, SkeletonText, Skeleton, Dialog, Portal, CloseButton, Progress, ButtonGroup, IconButton, Pagination, Table, Steps } from "@chakra-ui/react";
import NextLink from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  inferenceBackend?: string
  rtdetrEpochs?: number
  datasets?: string[]
  createdAt?: string
  updatedAt?: string
}

type ProgressState = "pending" | "running" | "completed" | "faild";
type ProgressStep = { key: string; label?: string; state?: ProgressState }
type JobProgress = { current_key?: string | null; steps?: ProgressStep[] }

const DEFAULT_PROGRESS_STEPS: { key: string; label: string }[] = [
  { key: "download", label: "Download" },
  { key: "preprocess", label: "Preprocess" },
  { key: "sam2", label: "SAM2" },
  { key: "dataset_export", label: "Dataset export" },
  { key: "rtdetr_train", label: "DETR train" },
  { key: "trt_export", label: "Model export" },
  { key: "rtdetr_infer", label: "DETR inference" },
  { key: "aggregate", label: "Aggregate" },
  { key: "postprocess", label: "Postprocess" },
  { key: "upload", label: "Upload" },
];

function normalizeState(state?: string | null): ProgressState {
  const s = (state || "").toLowerCase();
  if (s === "running") return "running";
  if (s === "completed" || s === "complete") return "completed";
  if (s === "faild" || s === "failed" || s === "fail") return "faild";
  return "pending";
}

type InferenceResultRow = {
  id: string
  bucket: string
  key: string
  size?: number
  createdAt?: string
  mime?: string
  meta?: any
}

type InferenceJobLogRow = {
  source: "mlx" | "cv" | string
  stream: "stdout" | "stderr" | string
  message: string
  seq?: number
  createdAt?: string
}

type InferenceJobLogArchiveRow = {
  bucket: string
  key: string
  rowCount?: number
  firstSeq?: number
  lastSeq?: number
  createdAt?: string
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

async function readLogArchives(archives: InferenceJobLogArchiveRow[]): Promise<InferenceJobLogRow[]> {
  if (archives.length === 0) return [];
  const allRows: InferenceJobLogRow[] = [];
  const linePattern = /^\[(.*?)\]\s+\[(.*?)\/(.*?)\]\s+\[#(.*?)\]\s?(.*)$/;
  for (const archive of archives) {
    const url = await getSignedObjectUrl(archive.bucket, archive.key, 60 * 10);
    const resp = await fetch(url);
    const text = await resp.text();
    for (const line of text.split(/\n/)) {
      if (!line) continue;
      const matched = line.match(linePattern);
      if (!matched) {
        allRows.push({ source: "log", stream: "stdout", message: line });
        continue;
      }
      allRows.push({
        createdAt: matched[1],
        source: matched[2] || "log",
        stream: matched[3] || "stdout",
        seq: matched[4] ? Number(matched[4]) : undefined,
        message: (matched[5] || "").replace(/\\n/g, "\n"),
      });
    }
  }
  return allRows;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function suggestFilename(base: string): string {
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function formatLogArchiveLine(line: InferenceJobLogRow): string {
  const createdAt = line.createdAt || "";
  const source = line.source || "log";
  const stream = line.stream || "stdout";
  const seq = line.seq ?? "";
  const message = (line.message || "").replace(/\r/g, "").replace(/\n/g, "\\n");
  return `[${createdAt}] [${source}/${stream}] [#${seq}] ${message}`;
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
  const [contentPanel, setContentPanel] = useState<"logs" | "artifacts">("logs");
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [downloadingLogFile, setDownloadingLogFile] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<any>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const setVideoNode = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoEl(node);
  }, []);

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
        inferenceBackend: r?.inferenceBackend,
        rtdetrEpochs: typeof r?.rtdetrEpochs === "number" ? r.rtdetrEpochs : undefined,
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

      const serverSteps: Record<string, ProgressStep> = {};
      if (Array.isArray(p?.steps)) {
        for (const s of p.steps) {
          if (!s?.key) continue;
          const key = String(s.key);
          serverSteps[key] = {
            key,
            label: s?.label ? String(s.label) : undefined,
            state: normalizeState((s as any)?.state),
          };
        }
      }

      const normalizedSteps: ProgressStep[] = DEFAULT_PROGRESS_STEPS.map((d) => {
        const matched = serverSteps[d.key];
        return {
          key: d.key,
          label: matched?.label || d.label,
          state: normalizeState(matched?.state || "pending"),
        };
      });

      const knownKeys = new Set(DEFAULT_PROGRESS_STEPS.map((d) => d.key));
      const extras = Object.values(serverSteps).filter((s) => !knownKeys.has(s.key));
      const steps = normalizedSteps.concat(extras);

      const currentKey = p?.current_key && knownKeys.has(String(p.current_key)) ? String(p.current_key) : (p?.current_key ?? null);

      return { current_key: currentKey, steps };
    },
    refetchOnWindowFocus: false,
    refetchInterval: 800,
    staleTime: 0,
  });

  const procSteps = useMemo(() => (progress?.steps ?? []).map((s) => ({
    id: String(s.key),
    title: String(s.label ?? s.key),
    state: normalizeState(s.state),
  })), [progress?.steps]);
  const currentStepId: string | null | undefined = progress?.current_key ?? null;
  const allCompleted = useMemo(() => procSteps.length > 0 && procSteps.every((s) => (s.state ?? "pending") === "completed"), [procSteps]);
  const firstFailedIndex = useMemo(() => procSteps.findIndex((s) => (s.state ?? "pending") === "faild"), [procSteps]);
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

  const jobIsTerminal = useMemo(() => {
    const s = (job?.status || "").toLowerCase();
    return s === "complete" || s === "completed" || s === "failed" || s === "faild" || s === "error" || s === "stopinterrept";
  }, [job?.status]);

  const jobIsCompleted = useMemo(() => {
    const s = (job?.status || "").toLowerCase();
    return s === "complete" || s === "completed";
  }, [job?.status]);

  const { data: dbLogs = [] } = useQuery({
    queryKey: ["inference-job-logs", job?.id],
    enabled: isSuccess && !!job?.id,
    queryFn: async (): Promise<InferenceJobLogRow[]> => {
      if (!job?.id) return [];
      const res = await surreal.query(
        "SELECT source, stream, message, seq, createdAt FROM inference_job_log WHERE job = <record> $job ORDER BY createdAt ASC, seq ASC",
        { job: job.id }
      );
      return extractRows<any>(res).map((row) => ({
        source: String(row?.source || "log"),
        stream: String(row?.stream || "stdout"),
        message: String(row?.message || ""),
        seq: typeof row?.seq === "number" ? row.seq : undefined,
        createdAt: row?.createdAt,
      }));
    },
    refetchOnWindowFocus: false,
    refetchInterval: jobIsTerminal ? 5000 : 1200,
    staleTime: 0,
  });

  const { data: logArchives = [] } = useQuery({
    queryKey: ["inference-job-log-archives", job?.id],
    enabled: isSuccess && !!job?.id,
    queryFn: async (): Promise<InferenceJobLogArchiveRow[]> => {
      if (!job?.id) return [];
      const res = await surreal.query(
        "SELECT bucket, key, rowCount, firstSeq, lastSeq, createdAt FROM inference_job_log_archive WHERE job = <record> $job ORDER BY firstSeq ASC, createdAt ASC",
        { job: job.id }
      );
      return extractRows<any>(res).map((row) => ({
        bucket: String(row?.bucket || ""),
        key: String(row?.key || ""),
        rowCount: typeof row?.rowCount === "number" ? row.rowCount : undefined,
        firstSeq: typeof row?.firstSeq === "number" ? row.firstSeq : undefined,
        lastSeq: typeof row?.lastSeq === "number" ? row.lastSeq : undefined,
        createdAt: row?.createdAt,
      })).filter((row) => row.bucket && row.key);
    },
    refetchOnWindowFocus: false,
    refetchInterval: jobIsTerminal ? false : 5000,
    staleTime: 0,
  });

  const { data: archivedLogs = [], isFetching: archivedLogsFetching } = useQuery({
    queryKey: ["inference-job-log-archive-rows", logArchives.map((a) => a.key).join("|")],
    enabled: logArchives.length > 0,
    queryFn: async (): Promise<InferenceJobLogRow[]> => readLogArchives(logArchives),
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const logs = useMemo(() => [...archivedLogs, ...dbLogs], [archivedLogs, dbLogs]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logs.length]);

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
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false);
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
  const isVideoResult = useCallback((r?: InferenceResultRow): boolean => {
    if (!r) return false;
    const m = (r.mime || "").toLowerCase();
    if (m.startsWith("video/")) return true;
    const ext = getExt(r.key);
    return /^(mp4|mov|mkv|avi|webm)$/i.test(ext);
  }, []);
  const isJsonResult = useCallback((r?: InferenceResultRow): boolean => {
    if (!r) return false;
    const m = (r.mime || "").toLowerCase();
    if (m === "application/json" || m.endsWith("+json")) return true;
    const ext = getExt(r.key);
    return ext === "json";
  }, []);
  const isParquetResult = useCallback((r?: InferenceResultRow): boolean => {
    if (!r) return false;
    const m = (r.mime || "").toLowerCase();
    if (m === "application/parquet" || m === "application/x-parquet") return true;
    const ext = getExt(r.key);
    return ext === "parquet";
  }, []);

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
    if (!artifactDialogOpen) return;
    const video = videoEl;
    if (!video) return;
    if (!m3u8Url) return;
    const canNativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "" ||
      video.canPlayType("application/x-mpegURL") !== "";
    if (canNativeHls) {
      if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* noop */ } hlsRef.current = null; }
      video.src = m3u8Url;
      try { video.load(); } catch { /* noop */ }
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
  }, [artifactDialogOpen, m3u8Url, videoEl]);

  // For parquet: check OPFS cache presence when selected and auto-download if missing
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!current?.key || !current?.bucket) return;
      if (!(job?.status === "Complete" || job?.status === "Completed")) return;
      if (job?.taskType !== "one-shot-object-detection") return;
      if (!isParquetResult(current)) return;
      setCheckingParquetLocal(true);
      try {
        const exists = await cacheExists(current.bucket, current.key);
        // no UI indicator; just proceed
        if (!exists) {
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
  }, [current, current?.bucket, current?.key, isParquetResult, job?.status, job?.taskType]);

  function formatTimestamp(ts?: string): string {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatLogTime(ts?: string): string {
    if (!ts) return "";
    const normalized = ts.startsWith("d'") && ts.endsWith("'") ? ts.slice(2, -1) : ts;
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatBytes(size?: number): string {
    const n = Number(size ?? 0);
    if (!Number.isFinite(n) || n <= 0) return "-";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = n;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
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

  const queryParquetPage = useCallback(async (url: string, page: number, bucketForCache?: string, keyForCache?: string) => {
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
  }, []);

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
  }, [current, isParquetResult, queryParquetPage, tablePage]);

  async function handleDownloadLogFile() {
    if (downloadingLogFile) return;
    setDownloadingLogFile(true);
    try {
      const text = logs.map(formatLogArchiveLine).join("\n") + "\n";
      const filename = suggestFilename(`${jobName || "inference_job"}_execution_logs.log`);
      downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
    } finally {
      setDownloadingLogFile(false);
    }
  }

  const renderLogConsole = (height: string) => (
    <Box
      rounded="lg"
      borderWidth="1px"
      bg="gray.950"
      color="gray.100"
      p="12px"
      h={height}
      overflowY="auto"
      fontFamily="mono"
      fontSize="xs"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
    >
      {logs.length === 0 ? (
        <Text color="gray.400">ログはまだありません。ジョブが開始されるとここに表示されます。</Text>
      ) : (
        <VStack align="stretch" gap="2">
          {logs.map((line, idx) => (
            <HStack key={`${line.createdAt || "log"}-${line.seq ?? idx}-${idx}`} align="start" gap="2">
              <Text as="span" color="gray.500" flexShrink={0}>{formatLogTime(line.createdAt)}</Text>
              <Badge
                size="xs"
                rounded="sm"
                colorPalette={line.source === "mlx" ? "blue" : line.source === "cv" ? "teal" : "gray"}
                flexShrink={0}
              >
                {line.source}
              </Badge>
              <Text as="span" color={line.stream === "stderr" ? "orange.200" : "gray.100"}>{line.message}</Text>
            </HStack>
          ))}
          <Box ref={logEndRef} />
        </VStack>
      )}
    </Box>
  );

  return (
    <Box px={{ base: "24px", xl: "5%" }} py="20px" overflowX="hidden">
      <Stack direction={{ base: "column", md: "row" }} align="stretch" justify="space-between" gap="8px">
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
        <HStack gap="8px" flexWrap="wrap" justify={{ base: "flex-start", md: "flex-end" }}>
          {job?.status === "ProcessWaiting" && (
            <Button size={{ base: "xs", md: "sm" }} rounded="full" variant="outline" onClick={async () => {
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
              <Button size={{ base: "xs", md: "sm" }} rounded="full" variant="outline" disabled={copying} onClick={async () => {
                if (!jobName || !job) return;
                setCopying(true);
                try {
                  // Build new job name: currentName + _copy
                  const newName = `${jobName}_copy`;
                  // Create a new job with the same parameters (taskType/model/datasets), fresh status/time
                  await surreal.query(
                    "CREATE inference_job SET name = $name, status = 'ProcessWaiting', taskType = $taskType, model = $model, modelSource = $modelSource, inferenceBackend = $inferenceBackend, rtdetrEpochs = $rtdetrEpochs, datasets = $datasets, createdAt = time::now(), updatedAt = time::now()",
                    {
                      name: newName,
                      taskType: job.taskType,
                      model: job.model,
                      modelSource: job.modelSource,
                      inferenceBackend: job.inferenceBackend || "tensorrt-fp16",
                      rtdetrEpochs: job.rtdetrEpochs || 4,
                      datasets: job.datasets || [],
                    }
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
              <Button size={{ base: "xs", md: "sm" }} rounded="full" colorPalette="red" disabled={removing}>{t("common.remove_job", "Remove Job")}</Button>
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
      </Stack>

      <Stack direction={{ base: "column", xl: "row" }} align="stretch" gap="16px" mt="16px" w="100%" minW={0}>
        <Box w={{ base: "100%", xl: "340px" }} flexShrink={0} rounded="md" borderWidth="1px" bg="bg.panel" p="16px" minW={0}>
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
              <Heading size="md">ジョブ詳細</Heading>
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
              <Text textStyle="sm" color="gray.700">Inference Backend: {job.inferenceBackend || "tensorrt-fp16"}</Text>
              <Text textStyle="sm" color="gray.700">RT-DETR Epochs: {job.rtdetrEpochs || 4}</Text>
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

            </VStack>
          )}
        </Box>

        <Box w={{ base: "100%", xl: "340px" }} flexShrink={0} rounded="md" borderWidth="1px" bg="bg.panel" p="16px" minH="240px" minW={0}>
          <VStack align="stretch" gap="12px">
            <Heading size="md">プログレス</Heading>
            {procSteps.length > 0 ? (
              <Box rounded="md" borderWidth="1px" p="12px" minH="300px" maxH="70vh" overflowY="auto" bg="bg.canvas">
                <Steps.Root orientation="vertical" count={procSteps.length} step={(allCompleted ? procSteps.length : activeIndex)}>
                  <Steps.List gap="4">
                    {procSteps.map((s, index) => {
                      const derivedStatus: ProgressState =
                        s.id === currentStepId && s.state !== "completed" && s.state !== "faild" ? "running" : (s.state ?? "pending");
                      return (
                        <Steps.Item key={s.id} index={index} title={s.title} py="3">
                          <Steps.Indicator />
                          <Steps.Title>{s.title}</Steps.Title>
                          <Steps.Separator my="3" borderLeftWidth="2px" borderColor="gray.300" opacity={1} />
                          <Steps.Content index={index}>
                            <VStack align="stretch" gap={3} mt={3} mb={6} w="full">
                              <HStack justify="space-between">
                                <Badge rounded="full" variant="subtle" colorPalette={
                                  derivedStatus === "running" ? "blue" : derivedStatus === "completed" ? "green" : derivedStatus === "faild" ? "red" : "gray"
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
            ) : (
              <Text textStyle="sm" color="gray.600">Progress is not available yet.</Text>
            )}
          </VStack>
        </Box>

        <Box flex="1" w={{ base: "100%", xl: "auto" }} minW={0} rounded="md" borderWidth="1px" bg="bg.panel" p="16px" minH="240px">
          <VStack align="stretch" gap="12px" minW={0}>
            <HStack justify="space-between" align="center" minW={0}>
              <Box minW={0}>
                <Heading size="md">{jobIsCompleted ? "ジョブ出力" : "実行ログ"}</Heading>
                <Text textStyle="sm" color="gray.600" mt="1">
                  {jobIsCompleted ? "実行ログと成果物を切り替えて確認できます。" : "MLX / CV backend の出力をこのジョブだけに絞って表示します。"}
                </Text>
              </Box>
              <HStack gap="8px" flexShrink={0}>
                {jobIsCompleted ? (
                  <ButtonGroup size="sm" variant="outline">
                    <Button
                      rounded="full"
                      colorPalette={contentPanel === "logs" ? "teal" : "gray"}
                      variant={contentPanel === "logs" ? "solid" : "outline"}
                      onClick={() => setContentPanel("logs")}
                    >
                      実行ログ
                    </Button>
                    <Button
                      rounded="full"
                      colorPalette={contentPanel === "artifacts" ? "teal" : "gray"}
                      variant={contentPanel === "artifacts" ? "solid" : "outline"}
                      onClick={() => setContentPanel("artifacts")}
                    >
                      成果物
                    </Button>
                  </ButtonGroup>
                ) : null}
                <Badge rounded="full" variant="subtle" colorPalette={jobIsTerminal ? "gray" : "green"}>
                  {jobIsTerminal ? "snapshot" : "streaming"}
                </Badge>
              </HStack>
            </HStack>
            {contentPanel === "logs" || !jobIsCompleted ? (
              <VStack align="stretch" gap="10px">
                <HStack justify="space-between" align="center" minW={0}>
                  <HStack gap="8px" flexWrap="wrap">
                    <Badge rounded="full" variant="subtle" colorPalette="gray">{logs.length.toLocaleString()} lines</Badge>
                    {archivedLogsFetching ? (
                      <Badge rounded="full" variant="subtle" colorPalette="orange">syncing logs</Badge>
                    ) : null}
                  </HStack>
                  <HStack gap="8px" flexShrink={0}>
                    <Button size="sm" rounded="full" variant="outline" onClick={() => setLogDialogOpen(true)}>
                      拡大
                    </Button>
                    {jobIsCompleted ? (
                      <Button size="sm" rounded="full" onClick={handleDownloadLogFile} disabled={downloadingLogFile}>
                        {downloadingLogFile ? "Exporting..." : "ダウンロード"}
                      </Button>
                    ) : null}
                  </HStack>
                </HStack>
                {renderLogConsole("420px")}
              </VStack>
            ) : job && jobIsCompleted && job.taskType === "one-shot-object-detection" ? (
              (!results || results.length === 0) ? (
                <Text color="gray.600">Result not ready yet.</Text>
              ) : (
                <VStack align="stretch" gap="8px" maxH="70vh" overflowY="auto" minW={0} style={{ scrollbarGutter: "stable both-edges" }}>
                  {results.map((r, idx) => {
                    const name = r.key.split("/").pop() || r.key;
                    const type = isVideoResult(r) ? "Video" : isJsonResult(r) ? "JSON" : isParquetResult(r) ? "Parquet" : "File";
                    const description = r?.meta?.description ? String(r.meta.description) : "";
                    const selected = idx === selectedIndex;
                    return (
                      <Box
                        key={r.id}
                        as="button"
                        onClick={() => {
                          setSelectedIndex(idx);
                          setTablePage(1);
                          setArtifactDialogOpen(true);
                        }}
                        textAlign="left"
                        rounded="lg"
                        borderWidth="1px"
                        p="12px"
                        bg={selected ? "teal.50" : "white"}
                        borderColor={selected ? "teal.300" : "gray.200"}
                        cursor="pointer"
                        transition="all 0.15s ease"
                        _hover={{ shadow: "md", borderColor: selected ? "teal.400" : "gray.400" }}
                      >
                        <VStack align="stretch" gap={2} minW={0}>
                          <HStack justify="space-between" gap="12px" minW={0}>
                            <Text textStyle="sm" fontWeight="semibold" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</Text>
                            <Badge
                              rounded="full"
                              variant="subtle"
                              colorPalette={type === "Video" ? "teal" : type === "JSON" ? "purple" : type === "Parquet" ? "blue" : "gray"}
                              flexShrink={0}
                            >
                              {type}
                            </Badge>
                          </HStack>
                          {description ? (
                            <Text textStyle="xs" color="gray.700"
                              style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {description}
                            </Text>
                          ) : null}
                          <HStack justify="space-between" gap="12px" minW={0}>
                            <Text textStyle="xs" color="gray.600" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.key}</Text>
                            <HStack gap="8px" flexShrink={0}>
                              <Text textStyle="xs" color="gray.600">{formatBytes(r.size)}</Text>
                              <Text textStyle="xs" color="gray.600">{formatTimestamp(r.createdAt)}</Text>
                            </HStack>
                          </HStack>
                        </VStack>
                      </Box>
                    );
                  })}
                </VStack>
              )
            ) : (
              <Text color="gray.500">このジョブの成果物はありません。</Text>
            )}
          </VStack>
        </Box>
      </Stack>

      <Dialog.Root open={logDialogOpen} onOpenChange={(e: any) => setLogDialogOpen(!!e.open)}>
        <Portal>
          <Dialog.Backdrop bg="blackAlpha.700" backdropFilter="blur(4px)" />
          <Dialog.Positioner p="0" alignItems="center" justifyContent="center" overflow="hidden">
            <Dialog.Content w="96vw" h="92dvh" maxW="1800px" rounded="xl" overflow="hidden" display="flex" flexDirection="column">
              <Dialog.Header borderBottomWidth="1px" gap="3" flexShrink={0}>
                <VStack align="stretch" gap="1" flex="1" minW={0}>
                  <Dialog.Title>実行ログ</Dialog.Title>
                  <Text textStyle="xs" color="gray.600">
                    {logs.length.toLocaleString()} lines
                  </Text>
                </VStack>
                <HStack gap="8px" flexShrink={0}>
                  {jobIsCompleted ? (
                    <Button size="sm" rounded="full" onClick={handleDownloadLogFile} disabled={downloadingLogFile}>
                      {downloadingLogFile ? "Exporting..." : "ダウンロード"}
                    </Button>
                  ) : null}
                  <CloseButton size="sm" onClick={() => setLogDialogOpen(false)} />
                </HStack>
              </Dialog.Header>
              <Dialog.Body p="16px" overflow="hidden" bg="gray.50" flex="1" minH={0}>
                {renderLogConsole("100%")}
              </Dialog.Body>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      <Dialog.Root open={artifactDialogOpen} onOpenChange={(e: any) => setArtifactDialogOpen(!!e.open)}>
        <Portal>
          <Dialog.Backdrop bg="blackAlpha.700" backdropFilter="blur(4px)" />
          <Dialog.Positioner p="0" alignItems="center" justifyContent="center" overflow="hidden">
            <Dialog.Content w="96vw" h="92dvh" maxW="1800px" rounded="xl" overflow="hidden" display="flex" flexDirection="column">
              <Dialog.Header borderBottomWidth="1px" gap="3" flexShrink={0}>
                <VStack align="stretch" gap="1" flex="1" minW={0}>
                  <HStack gap="3" minW={0}>
                    <Dialog.Title>
                      {current?.key.split("/").pop() || "成果物プレビュー"}
                    </Dialog.Title>
                    {current ? (
                      <Badge
                        rounded="full"
                        variant="subtle"
                        colorPalette={isVideoResult(current) ? "teal" : isJsonResult(current) ? "purple" : isParquetResult(current) ? "blue" : "gray"}
                        flexShrink={0}
                      >
                        {isVideoResult(current) ? "Video" : isJsonResult(current) ? "JSON" : isParquetResult(current) ? "Parquet" : "File"}
                      </Badge>
                    ) : null}
                  </HStack>
                  {current ? (
                    <Text textStyle="xs" color="gray.600" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current.key}</Text>
                  ) : null}
                </VStack>
                <HStack gap="8px" flexShrink={0} align="center">
                  {current && isJsonResult(current) ? (
                    <Button size="sm" rounded="full" variant="outline" onClick={async () => {
                      try {
                        if (!jsonData) {
                          await refetchJson();
                        }
                        const text = (jsonData && jsonData._raw) ? String(jsonData._raw) : JSON.stringify(jsonData ?? {}, null, 2);
                        await navigator.clipboard.writeText(text);
                      } catch { /* ignore */ }
                    }} disabled={jsonLoading || !!jsonError}>Copy JSON</Button>
                  ) : null}
                  {current && isParquetResult(current) ? (
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
                  ) : null}
                  {current ? (
                    <Button size="sm" rounded="full" variant="outline" onClick={() => downloadDirect(current.bucket, current.key)}>
                      Download
                    </Button>
                  ) : null}
                  <CloseButton size="sm" onClick={() => setArtifactDialogOpen(false)} />
                </HStack>
              </Dialog.Header>
              <Dialog.Body p="16px" overflow="auto" bg="gray.50" flex="1" minH={0}>
                {!current ? (
                  <Text color="gray.600">Select a file to preview.</Text>
                ) : isVideoResult(current) ? (
                  playlistLoading ? (
                    <Text textStyle="sm" color="gray.600">Loading player...</Text>
                  ) : !playlist ? (
                    <Box>
                      <Text fontWeight="bold">HLS playlist not available.</Text>
                      <Text textStyle="sm" color="gray.600" mt={1}>The video is not yet segmented or unavailable.</Text>
                    </Box>
                  ) : (
                    <Box h="100%" minH={0} display="flex" alignItems="center" justifyContent="center">
                      <video
                        ref={setVideoNode}
                        controls
                        playsInline
                        style={{ width: "100%", maxHeight: "100%", background: "black", borderRadius: "12px" }}
                      >
                        <track kind="captions" label="captions" srcLang="en" src="data:," />
                      </video>
                    </Box>
                  )
                ) : isJsonResult(current) ? (
                  jsonLoading ? (
                    <Text textStyle="sm" color="gray.600">Loading JSON...</Text>
                  ) : jsonError ? (
                    <HStack color="red.500" justify="space-between">
                      <Box>Failed to load JSON</Box>
                      <Button size="xs" variant="outline" onClick={() => refetchJson()}>Retry</Button>
                    </HStack>
                  ) : (
                    <Box as="pre" p="16px" bg="white" borderWidth="1px" rounded="lg" overflow="auto" minH="100%" fontSize="sm">
                      {(() => {
                        try {
                          const text = jsonData && jsonData._raw ? String(jsonData._raw) : JSON.stringify(jsonData, null, 2);
                          return highlightJsonToNodes(text);
                        } catch {
                          return String(jsonData);
                        }
                      })()}
                    </Box>
                  )
                ) : isParquetResult(current) ? (
                  pqError ? (
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
                    <VStack align="stretch" gap="12px">
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
                      <Box overflowX="auto" borderWidth="1px" rounded="lg" bg="white">
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
                    </VStack>
                  )
                ) : (
                  <VStack align="start" gap="12px">
                    <Text color="gray.600">Preview is not available for this file type.</Text>
                    <Button rounded="full" onClick={() => downloadDirect(current.bucket, current.key)}>Download</Button>
                  </VStack>
                )}
              </Dialog.Body>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Box>
  );
}

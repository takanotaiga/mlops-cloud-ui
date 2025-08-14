"use client";

import { Box, Heading, HStack, VStack, Text, Button, Badge, Link, SkeletonText, Skeleton, Dialog, Portal, CloseButton, Progress, ButtonGroup, IconButton, Pagination, Table, Separator, Accordion, Span } from "@chakra-ui/react";
import NextLink from "next/link";
import { useSearchParams , useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { decodeBase64Utf8 } from "@/components/utils/base64";
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { extractRows } from "@/components/surreal/normalize";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { getSignedObjectUrl } from "@/components/utils/minio";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";

type JobRow = {
  id: string
  name: string
  status?: string
  taskType?: string
  model?: string
  datasets?: string[]
  createdAt?: string
  updatedAt?: string
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
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [downloadPct, setDownloadPct] = useState<number>(0);
  const [checkingLocal, setCheckingLocal] = useState<boolean>(false);
  const [checkingParquetLocal, setCheckingParquetLocal] = useState<boolean>(false);

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
    setVideoUrl(null);
  }, [results.length]);
  const current = useMemo(() => (results && results.length > 0 ? results[Math.min(results.length - 1, Math.max(0, selectedIndex))] : undefined), [results, selectedIndex]);

  // Group results by minute key
  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; date: Date | null; items: { idx: number; r: InferenceResultRow }[] }>();
    results.forEach((r, idx) => {
      const key = formatMinuteKey(r.createdAt);
      const date = r.createdAt ? new Date(r.createdAt) : null;
      const item = { idx, r };
      const entry = map.get(key);
      if (entry) {
        entry.items.push(item);
      } else {
        map.set(key, { key, date: (date && !isNaN(date.getTime())) ? date : null, items: [item] });
      }
    });
    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (a.date && b.date) return b.date.getTime() - a.date.getTime();
      if (a.date) return -1;
      if (b.date) return 1;
      return b.key.localeCompare(a.key);
    });
    list.forEach((g) => {
      g.items.sort((a, b) => {
        const da = a.r.createdAt ? new Date(a.r.createdAt).getTime() : 0;
        const db = b.r.createdAt ? new Date(b.r.createdAt).getTime() : 0;
        return db - da;
      });
    });
    return list;
  }, [results]);

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

  // OPFS helpers (used for videos only)
  async function getOpfsRoot(): Promise<any> {
    const ns: any = (navigator as any).storage;
    if (!ns?.getDirectory) throw new Error("OPFS not supported");
    return await ns.getDirectory();
  }
  async function ensurePath(root: any, path: string, create: boolean): Promise<{ dir: any; name: string }> {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop() || "";
    let dir = root;
    for (const p of parts) {
      dir = await dir.getDirectoryHandle(p, { create });
    }
    return { dir, name };
  }
  async function opfsFileExists(path: string): Promise<boolean> {
    try {
      const root = await getOpfsRoot();
      const { dir, name } = await ensurePath(root, path, false);
      await dir.getFileHandle(name, { create: false });
      return true;
    } catch { return false; }
  }
  async function getOpfsFileUrl(path: string): Promise<string> {
    const root = await getOpfsRoot();
    const { dir, name } = await ensurePath(root, path, false);
    const fh = await dir.getFileHandle(name, { create: false });
    const file = await fh.getFile();
    return URL.createObjectURL(file);
  }
  async function readOpfsFileBytes(path: string): Promise<Uint8Array> {
    const root = await getOpfsRoot();
    const { dir, name } = await ensurePath(root, path, false);
    const fh = await dir.getFileHandle(name, { create: false });
    const file = await fh.getFile();
    const ab = await file.arrayBuffer();
    return new Uint8Array(ab);
  }
  async function downloadToOpfsWithProgress(bucket: string, key: string, expectedSize?: number) {
    setDownloading(true);
    setDownloadPct(0);
    try {
      const url = await getSignedObjectUrl(bucket, key, 60 * 30);
      const resp = await fetch(url);
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      const total = expectedSize && expectedSize > 0 ? expectedSize : Number(resp.headers.get("Content-Length") || 0);
      const reader = resp.body.getReader();
      const root = await getOpfsRoot();
      const { dir, name } = await ensurePath(root, key, true);
      const fh = await dir.getFileHandle(name, { create: true });
      const writable = await (fh as any).createWritable();
      let downloaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          await writable.write(value);
          downloaded += value.length || value.byteLength || 0;
          if (total > 0) setDownloadPct(Math.min(100, Math.round((downloaded / total) * 100)));
        }
      }
      await writable.close();
      const fileUrl = await getOpfsFileUrl(key);
      setVideoUrl((prev) => { if (prev && prev.startsWith("blob:")) { try { URL.revokeObjectURL(prev); } catch { } } return fileUrl; });
      setDownloadPct(100);
    } finally {
      setDownloading(false);
    }
  }
  async function downloadFileToOpfsWithProgress(bucket: string, key: string, expectedSize?: number) {
    setDownloading(true);
    setDownloadPct(0);
    try {
      const url = await getSignedObjectUrl(bucket, key, 60 * 30);
      const resp = await fetch(url);
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      const total = expectedSize && expectedSize > 0 ? expectedSize : Number(resp.headers.get("Content-Length") || 0);
      const reader = resp.body.getReader();
      const root = await getOpfsRoot();
      const { dir, name } = await ensurePath(root, key, true);
      const fh = await dir.getFileHandle(name, { create: true });
      const writable = await (fh as any).createWritable();
      let downloaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          await writable.write(value);
          downloaded += value.length || value.byteLength || 0;
          if (total > 0) setDownloadPct(Math.min(100, Math.round((downloaded / total) * 100)));
        }
      }
      await writable.close();
      setDownloadPct(100);
    } finally {
      setDownloading(false);
    }
  }

  // On page/result change, if exists in OPFS already (videos), open it immediately and hide download button
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!current?.key || !(job && (job.status === "Complete" || job.status === "Completed") && job.taskType === "one-shot-object-detection")) return;
      if (!isVideoResult(current)) return;
      setCheckingLocal(true);
      try {
        const exists = await opfsFileExists(current.key);
        if (exists) {
          const url = await getOpfsFileUrl(current.key);
          if (!cancelled) setVideoUrl((prev) => { if (prev && prev.startsWith("blob:")) { try { URL.revokeObjectURL(prev); } catch { } } return url; });
        } else {
          if (!cancelled) setVideoUrl(null);
          // Auto-download video to OPFS for local cache
          if (!downloading) {
            try {
              await downloadToOpfsWithProgress(current.bucket, current.key, current.size);
            } catch { /* ignore */ }
          }
        }
      } catch {
        if (!cancelled) setVideoUrl(null);
      } finally {
        if (!cancelled) setCheckingLocal(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [current?.key, job?.status, job?.taskType]);

  // For parquet: check OPFS cache presence when selected and auto-download if missing
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!current?.key || !(job && (job.status === "Complete" || job.status === "Completed") && job.taskType === "one-shot-object-detection")) return;
      if (!isParquetResult(current)) return;
      setCheckingParquetLocal(true);
      try {
        const exists = await opfsFileExists(current.key);
        // no UI indicator; just proceed
        if (!exists && !downloading) {
          try {
            await downloadFileToOpfsWithProgress(current.bucket, current.key, current.size);
          } catch { /* ignore */ }
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

  function formatMinuteKey(ts?: string): string {
    if (!ts) return "Unknown";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "Unknown";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function handleRemove() {
    if (!jobName || removing) return;
    setRemoving(true);
    try {
      await surreal.query("DELETE inference_job WHERE name == $name", { name: jobName });
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
    const regex = /(\"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\\"])*\"\s*:)|(\"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\\"])*\")|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?/g;
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

  async function queryParquetPage(url: string, page: number, useOpfsIfAvailable: boolean = true, keyForOpfs?: string) {
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
      // Acquire parquet bytes either from OPFS (if present) or fetch
      let fileBuf: Uint8Array;
      if (useOpfsIfAvailable && keyForOpfs) {
        try {
          if (await opfsFileExists(keyForOpfs)) {
            fileBuf = await readOpfsFileBytes(keyForOpfs);
          } else {
            const fileResp = await fetch(url);
            fileBuf = new Uint8Array(await fileResp.arrayBuffer());
          }
        } catch {
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
        if (!cancelled) await queryParquetPage(url, tablePage, true, current.key);
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
              } catch { }
            }}>{t("common.stop", "Stop")}</Button>
          )}
          {job && job.status !== "ProcessWaiting" && (
            (job.status === "StopInterrept" || job.status === "Complete" || job.status === "Completed" || job.status === "Failed" || job.status === "Faild" || job.status === "Error")
          ) && (
              <Button size="sm" rounded="full" variant="outline" onClick={async () => {
                if (!jobName) return;
                try {
                  await surreal.query("UPDATE inference_job SET status = 'ProcessWaiting', updatedAt = time::now() WHERE name == $name", { name: jobName });
                  queryClient.invalidateQueries({ queryKey: ["inference-jobs"] });
                  refetch();
                } catch { }
              }}>{t("common.rerun_job", "Rerun job")}</Button>
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

              {/* Results list (grouped by minute) */}
              {(job.status === "Complete" || job.status === "Completed") && job.taskType === "one-shot-object-detection" && (
                <VStack align="stretch" gap="8px" mt="8px">
                  <Separator />
                  <Heading size="sm">Results</Heading>
                  {(!results || results.length === 0) ? (
                    <Text textStyle="sm" color="gray.600">Result not ready yet.</Text>
                  ) : (
                    <Accordion.Root collapsible defaultValue={grouped.length ? [grouped[0].key] : []}>
                      {grouped.map((g) => (
                        <Accordion.Item key={g.key} value={g.key}>
                          <Accordion.ItemTrigger>
                            <Span flex="1">{g.key}</Span>
                            <Accordion.ItemIndicator />
                          </Accordion.ItemTrigger>
                          <Accordion.ItemContent>
                            <Accordion.ItemBody>
                              <VStack align="stretch" gap="4px" maxH="260px" overflowY="auto" style={{ scrollbarGutter: "stable both-edges" }}>
                                {g.items.map(({ idx, r }) => {
                                  const name = r.key.split("/").pop() || r.key;
                                  const type = isVideoResult(r) ? "Video" : isJsonResult(r) ? "JSON" : isParquetResult(r) ? "Parquet" : "File";
                                  const selected = idx === selectedIndex;
                                  return (
                                    <Button key={r.id}
                                      variant={selected ? "solid" : "outline"}
                                      colorPalette={selected ? "teal" : "gray"}
                                      justifyContent="space-between"
                                      size="sm"
                                      onClick={() => { setSelectedIndex(idx); setVideoUrl(null); setTablePage(1); }}
                                    >
                                      <HStack justify="space-between" w="full">
                                        <Text textStyle="sm" maxW="70%" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</Text>
                                        <HStack gap="2">
                                          <Badge rounded="full" variant="subtle">{type}</Badge>
                                          <Text textStyle="xs" color="gray.600">{formatTimestamp(r.createdAt)}</Text>
                                        </HStack>
                                      </HStack>
                                    </Button>
                                  );
                                })}
                              </VStack>
                            </Accordion.ItemBody>
                          </Accordion.ItemContent>
                        </Accordion.Item>
                      ))}
                    </Accordion.Root>
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
                  {/* Current Result */}
                  {current && isVideoResult(current) ? (
                    videoUrl ? (
                      <>
                        <video controls style={{ width: "100%", maxHeight: "70vh" }} src={videoUrl} />
                      </>
                    ) : (
                      <>
                        {checkingLocal ? (
                          <Text textStyle="sm" color="gray.600">Checking local cache...</Text>
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
                      </>
                    )
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
                      <HStack>
                        <Button size="sm" rounded="full" onClick={async () => {
                          try {
                            const toCopy = jsonData && jsonData._raw ? String(jsonData._raw) : JSON.stringify(jsonData, null, 2);
                            await navigator.clipboard.writeText(toCopy);
                          } catch { }
                        }}>Copy JSON</Button>
                        <Button size="sm" rounded="full" variant="outline" onClick={() => downloadDirect(current.bucket, current.key)}>Download JSON</Button>
                      </HStack>
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
                              await queryParquetPage(url, tablePage, true, current.key);
                            } catch { }
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
                          <HStack justify="flex-end" mb="8px">
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
                                } catch { }
                              }}
                            >
                              {t("inference.detailed_analysis", "Detailed Analysis")}
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

"use client";

import { Box, Heading, HStack, VStack, Text, Link, Badge, Select, CheckboxGroup, Checkbox, Separator, SkeletonText, Skeleton, createListCollection, Portal } from "@chakra-ui/react";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { decodeBase64Utf8 } from "@/components/utils/base64";
import { getSignedObjectUrl } from "@/components/utils/minio";
import { useI18n } from "@/components/i18n/LanguageProvider";

type ChartType = "line" | "frequency" | "derivative"

type LoadedParquet = {
  cols: string[]
  rows: any[]
}

export default function ClientDetailedAnalysisPage() {
  const { t } = useI18n();
  const params = useSearchParams();

  const jobName = useMemo(() => {
    const j = params.get("j");
    if (!j) return "";
    try { return decodeBase64Utf8(j); } catch { return ""; }
  }, [params]);
  const bucket = useMemo(() => {
    const b = params.get("b");
    if (!b) return "";
    try { return decodeBase64Utf8(b); } catch { return ""; }
  }, [params]);
  const key = useMemo(() => {
    const k = params.get("k");
    if (!k) return "";
    try { return decodeBase64Utf8(k); } catch { return ""; }
  }, [params]);

  // OPFS helpers (optional cache)
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
  async function readOpfsFileBytes(path: string): Promise<Uint8Array> {
    const root = await getOpfsRoot();
    const { dir, name } = await ensurePath(root, path, false);
    const fh = await dir.getFileHandle(name, { create: false });
    const file = await fh.getFile();
    const ab = await file.arrayBuffer();
    return new Uint8Array(ab);
  }

  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pq, setPq] = useState<LoadedParquet | null>(null);

  // Load Parquet via duckdb-wasm from CDN; limit rows for chart performance
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!bucket || !key) return;
      setLoading(true);
      setLoadError(null);
      try {
        const importer = new Function("u", "return import(u)") as (u: string) => Promise<any>;
        let mod: any;
        try { mod = await importer("https://esm.sh/@duckdb/duckdb-wasm@1.28.0/dist/duckdb-browser.mjs"); } catch {
          mod = await importer("https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/dist/duckdb-browser.mjs");
        }
        const bundles = mod.getJsDelivrBundles();
        const bundle = (bundles && (bundles.mvp || bundles.standalone || bundles["mvp"])) || (await mod.selectBundle(bundles));
        const workerUrl = bundle.mainWorker || bundle.worker;
        let worker: Worker;
        try {
          const resp = await fetch(workerUrl, { mode: "cors" });
          const scriptText = await resp.text();
          const blobUrl = URL.createObjectURL(new Blob([scriptText], { type: "text/javascript" }));
          worker = new Worker(blobUrl);
        } catch {
          worker = new Worker(workerUrl);
        }
        const logger = new mod.ConsoleLogger();
        const db = new mod.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        const conn = await db.connect();
        // fetch parquet bytes (prefer OPFS cache)
        let fileBuf: Uint8Array;
        try {
          if (await opfsFileExists(key)) {
            fileBuf = await readOpfsFileBytes(key);
          } else {
            const url = await getSignedObjectUrl(bucket, key, 60 * 10);
            const resp = await fetch(url);
            fileBuf = new Uint8Array(await resp.arrayBuffer());
          }
        } catch {
          const url = await getSignedObjectUrl(bucket, key, 60 * 10);
          const resp = await fetch(url);
          fileBuf = new Uint8Array(await resp.arrayBuffer());
        }
        await db.registerFileBuffer("current.parquet", fileBuf);
        const LIMIT = 5000;
        const res: any = await conn.query(`SELECT * FROM read_parquet('current.parquet') LIMIT ${LIMIT}`);
        const rows: any[] = (res as any)?.toArray?.() ?? [];
        const cols: string[] = (res as any)?.schema?.fields?.map((f: any) => String(f.name)) ?? (rows[0] ? Object.keys(rows[0]) : []);
        await conn.close();
        await db.terminate();
        if (!cancelled) setPq({ cols, rows });
      } catch (e: any) {
        if (!cancelled) setLoadError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [bucket, key]);

  // Column selections
  const [chartType, setChartType] = useState<ChartType>("line");
  const [xCol, setXCol] = useState<string>("");
  const [maWindow, setMaWindow] = useState<number>(1);
  const [yAxisMode, setYAxisMode] = useState<"auto" | "zeroToMax">("auto");
  const [freqCol, setFreqCol] = useState<string>("");
  const [freqTopN, setFreqTopN] = useState<number>(20);
  const [freqAsPercent, setFreqAsPercent] = useState<boolean>(false);
  // Helper: check if value is a finite number (accept numeric strings); 'NaN' and null treated as missing
  function toFiniteNumber(v: any): number | null {
    if (v == null) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "bigint") {
      // Prefer safe integer conversion; fall back to parsing string
      const n = Number(v);
      if (Number.isFinite(n)) return n;
      const p = Number.parseFloat(v.toString());
      return Number.isFinite(p) ? p : null;
    }
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "" || s === "nan") return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
  // Columns that have at least one finite numeric value
  const numericCols = useMemo(() => {
    const rows = pq?.rows || [];
    const cols = pq?.cols || [];
    const result: string[] = [];
    for (const c of cols) {
      let hasFinite = false;
      for (let i = 0; i < rows.length; i++) {
        const n = toFiniteNumber(rows[i]?.[c]);
        if (n != null) { hasFinite = true; break; }
      }
      if (hasFinite) result.push(c);
    }
    return result;
  }, [pq?.cols, pq?.rows]);

  // Prune selected Y columns if they become invalid after recalculation
  useEffect(() => {
    setYCols((prev) => prev.filter((c) => numericCols.includes(c)));
  }, [numericCols]);
  const [yCols, setYCols] = useState<string[]>([]);

  // Initialize defaults when data loads
  useEffect(() => {
    if (!pq) return;
    if (!xCol) {
      const firstNumeric = numericCols[0] || "";
      setXCol(firstNumeric);
    } else if (!numericCols.includes(xCol)) {
      // If current xCol became invalid, switch to first numeric
      const firstNumeric = numericCols[0] || "";
      setXCol(firstNumeric);
    }
    if (yCols.length === 0 && numericCols.length > 0) {
      setYCols([numericCols[0]]);
    }
    if (!freqCol && (pq?.cols?.length ?? 0) > 0) {
      setFreqCol(pq!.cols[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pq, numericCols]);

  // Prepare chart data and series
  const chartData = useMemo(() => {
    if (!pq || !xCol) return [];
    const rows = pq.rows;
    const out: any[] = [];
    for (const r of rows) {
      const xv = toFiniteNumber(r?.[xCol]);
      if (xv == null) continue; // require numeric X
      const obj: any = { [xCol]: xv };
      for (const y of yCols) {
        const yv = toFiniteNumber(r?.[y]);
        obj[y] = yv == null ? NaN : yv;
      }
      out.push(obj);
    }
    return out;
  }, [pq, xCol, yCols]);

  const series = useMemo(() => yCols.map((name, i) => ({ name, color: COLORS[i % COLORS.length] })), [yCols]);

  // Frequency data for bar chart
  const allCols = pq?.cols ?? [];
  const freqData = useMemo(() => {
    if (!pq || !freqCol) return [] as { label: string; value: number }[];
    const map = new Map<string, number>();
    let total = 0;
    for (const r of pq.rows) {
      const v = r?.[freqCol];
      let key: string;
      if (v == null) key = "null";
      else if (typeof v === "string") key = v;
      else if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") key = String(v);
      else {
        try { key = JSON.stringify(v); } catch { key = String(v); }
      }
      map.set(key, (map.get(key) ?? 0) + 1);
      total += 1;
    }
    const arr = Array.from(map.entries()).map(([label, count]) => ({ label, value: freqAsPercent ? (count / Math.max(1, total)) : count }));
    arr.sort((a, b) => b.value - a.value);
    const top = arr.slice(0, Math.max(1, freqTopN));
    if (arr.length > top.length) {
      const restSum = arr.slice(top.length).reduce((s, x) => s + x.value, 0);
      top.push({ label: "Others", value: restSum });
    }
    return top;
  }, [pq, freqCol, freqTopN, freqAsPercent]);

  return (
    <Box px="10%" py="20px">
      <HStack align="center" justify="space-between">
        <HStack gap="3" align="center">
          <Heading size="2xl">
            <Link asChild color="black" _hover={{ textDecoration: "none", color: "black" }}>
              <NextLink href={`/inference/opened-job?j=${encodeURIComponent(params.get("j") || "")}`}>{t("inference.detail.breadcrumb", "Inference 🤖")}</NextLink>
            </Link>
            {" / "}
            {jobName || "(unknown)"}
          </Heading>
          <Badge rounded="full" variant="subtle" colorPalette="teal">{t("inference.badge", "Inference")}</Badge>
        </HStack>
      </HStack>

      <VStack align="stretch" gap="16px" mt="16px">
        <Text textStyle="sm" color="gray.700">Detailed analysis for: {key.split("/").pop() || key}</Text>
        <Separator />

        {/* Controls */}
        <HStack gap="16px" align="flex-start" wrap="wrap">
          <VStack align="stretch" minW="220px">
            <Text textStyle="sm" color="gray.600">Chart type</Text>
            <Select.Root
              size="sm"
              width="100%"
              collection={createListCollection({ items: [
                { label: "Line Chart", value: "line" },
                { label: "Frequency", value: "frequency" },
                { label: "Derivative", value: "derivative" },
              ] })}
              value={[chartType]}
              onValueChange={(d: any) => setChartType((d?.value?.[0] ?? "line") as ChartType)}
            >
              <Select.HiddenSelect />
              <Select.Control>
                <Select.Trigger>
                  <Select.ValueText placeholder="Chart type" />
                </Select.Trigger>
                <Select.IndicatorGroup>
                  <Select.Indicator />
                </Select.IndicatorGroup>
              </Select.Control>
              <Portal>
                <Select.Positioner>
                  <Select.Content>
                    {[
                      { label: "Line Chart", value: "line" },
                      { label: "Frequency", value: "frequency" },
                      { label: "Derivative", value: "derivative" },
                    ].map((it) => (
                      <Select.Item key={it.value} item={it}>
                        {it.label}
                        <Select.ItemIndicator />
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Positioner>
              </Portal>
            </Select.Root>
          </VStack>
          {(chartType === "line" || chartType === "derivative") && (
          <VStack align="stretch" minW="240px">
            <Text textStyle="sm" color="gray.600">X Axis</Text>
            <Select.Root
              size="sm"
              width="100%"
              collection={createListCollection({ items: numericCols.map((c) => ({ label: c, value: c })) })}
              value={xCol ? [xCol] : []}
              onValueChange={(d: any) => setXCol(d?.value?.[0] ?? "")}
            >
              <Select.HiddenSelect />
              <Select.Control>
                <Select.Trigger>
                  <Select.ValueText placeholder="Select X axis" />
                </Select.Trigger>
                <Select.IndicatorGroup>
                  <Select.Indicator />
                </Select.IndicatorGroup>
              </Select.Control>
              <Portal>
                <Select.Positioner>
                  <Select.Content>
                    {numericCols.map((c) => (
                      <Select.Item key={c} item={{ label: c, value: c }}>
                        {c}
                        <Select.ItemIndicator />
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Positioner>
              </Portal>
            </Select.Root>
          </VStack>
          )}
          {(chartType === "line" || chartType === "derivative") && (
          <VStack align="stretch" minW="280px">
            <Text textStyle="sm" color="gray.600">Y Axis (multiple)</Text>
            <CheckboxGroup value={yCols} onValueChange={(v: any) => setYCols((v?.value ?? v) as string[])}>
              <VStack align="stretch" h="110px" overflowY="auto" borderWidth="1px" rounded="md" p="8px" bg="bg.panel" style={{ scrollbarGutter: "stable both-edges" }}>
                {numericCols.map((c) => (
                  <Checkbox.Root key={c} value={c}>
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Checkbox.Label>{c}</Checkbox.Label>
                  </Checkbox.Root>
                ))}
                {numericCols.length === 0 && (
                  <Text textStyle="xs" color="gray.500">No numeric columns</Text>
                )}
              </VStack>
            </CheckboxGroup>
          </VStack>
          )}
          {(chartType === "line" || chartType === "derivative") && (
          <VStack align="stretch" minW="200px">
            <Text textStyle="sm" color="gray.600">Moving average</Text>
            <Select.Root
              size="sm"
              width="100%"
              collection={createListCollection({ items: [1,3,5,7,9,11].map((n) => ({ label: n === 1 ? "None" : `${n}`, value: String(n) })) })}
              value={[String(maWindow)]}
              onValueChange={(d: any) => {
                const v = Number(d?.value?.[0] ?? "1");
                setMaWindow(!Number.isFinite(v) || v < 1 ? 1 : v);
              }}
            >
              <Select.HiddenSelect />
              <Select.Control>
                <Select.Trigger>
                  <Select.ValueText placeholder="Window" />
                </Select.Trigger>
                <Select.IndicatorGroup>
                  <Select.Indicator />
                </Select.IndicatorGroup>
              </Select.Control>
              <Portal>
                <Select.Positioner>
                  <Select.Content>
                    {[1,3,5,7,9,11].map((n) => (
                      <Select.Item key={n} item={{ label: n === 1 ? "None" : `${n}`, value: String(n) }}>
                        {n === 1 ? "None" : `${n}`}
                        <Select.ItemIndicator />
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Positioner>
              </Portal>
            </Select.Root>
          </VStack>
          )}
          {(chartType === "line" || chartType === "derivative") && (
          <VStack align="stretch" minW="200px">
            <Text textStyle="sm" color="gray.600">Y Axis</Text>
            <Select.Root
              size="sm"
              width="100%"
              collection={createListCollection({ items: [
                { label: "Auto", value: "auto" },
                { label: "0 to Max", value: "zeroToMax" },
              ] })}
              value={[yAxisMode]}
              onValueChange={(d: any) => setYAxisMode(((d?.value?.[0] ?? "auto") as any))}
            >
              <Select.HiddenSelect />
              <Select.Control>
                <Select.Trigger>
                  <Select.ValueText placeholder="Y axis mode" />
                </Select.Trigger>
                <Select.IndicatorGroup>
                  <Select.Indicator />
                </Select.IndicatorGroup>
              </Select.Control>
              <Portal>
                <Select.Positioner>
                  <Select.Content>
                    {[
                      { label: "Auto", value: "auto" },
                      { label: "0 to Max", value: "zeroToMax" },
                    ].map((it) => (
                      <Select.Item key={it.value} item={it}>
                        {it.label}
                        <Select.ItemIndicator />
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Positioner>
              </Portal>
            </Select.Root>
          </VStack>
          )}
          {chartType === "frequency" && (
            <>
              <VStack align="stretch" minW="240px">
                <Text textStyle="sm" color="gray.600">Column</Text>
                <Select.Root
                  size="sm"
                  width="100%"
                  collection={createListCollection({ items: allCols.map((c) => ({ label: c, value: c })) })}
                  value={freqCol ? [freqCol] : []}
                  onValueChange={(d: any) => setFreqCol(d?.value?.[0] ?? "")}
                >
                  <Select.HiddenSelect />
                  <Select.Control>
                    <Select.Trigger>
                      <Select.ValueText placeholder="Select column" />
                    </Select.Trigger>
                    <Select.IndicatorGroup>
                      <Select.Indicator />
                    </Select.IndicatorGroup>
                  </Select.Control>
                  <Portal>
                    <Select.Positioner>
                      <Select.Content>
                        {allCols.map((c) => (
                          <Select.Item key={c} item={{ label: c, value: c }}>
                            {c}
                            <Select.ItemIndicator />
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Positioner>
                  </Portal>
                </Select.Root>
              </VStack>
              <VStack align="stretch" minW="180px">
                <Text textStyle="sm" color="gray.600">Top N</Text>
                <Select.Root
                  size="sm"
                  width="100%"
                  collection={createListCollection({ items: [5,10,20,30,50].map((n) => ({ label: String(n), value: String(n) })) })}
                  value={[String(freqTopN)]}
                  onValueChange={(d: any) => setFreqTopN(Number(d?.value?.[0] ?? "20"))}
                >
                  <Select.HiddenSelect />
                  <Select.Control>
                    <Select.Trigger>
                      <Select.ValueText placeholder="Top N" />
                    </Select.Trigger>
                    <Select.IndicatorGroup>
                      <Select.Indicator />
                    </Select.IndicatorGroup>
                  </Select.Control>
                  <Portal>
                    <Select.Positioner>
                      <Select.Content>
                        {[5,10,20,30,50].map((n) => (
                          <Select.Item key={n} item={{ label: String(n), value: String(n) }}>
                            {n}
                            <Select.ItemIndicator />
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Positioner>
                  </Portal>
                </Select.Root>
              </VStack>
              <VStack align="stretch" minW="200px">
                <Text textStyle="sm" color="gray.600">Normalize (%)</Text>
                <Checkbox.Root checked={freqAsPercent} onCheckedChange={(e: any) => setFreqAsPercent(!!(e?.checked ?? e))}>
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                  <Checkbox.Label>Show as percentage</Checkbox.Label>
                </Checkbox.Root>
              </VStack>
            </>
          )}
        </HStack>

        {/* Chart */}
        <Box rounded="md" borderWidth="1px" bg="bg.panel" p="12px" minH="300px">
          {loading ? (
            <>
              <SkeletonText noOfLines={1} w="30%" />
              <Skeleton mt="2" h="200px" />
            </>
          ) : loadError ? (
            <Text color="red.500">Failed to load parquet: {loadError}</Text>
          ) : !pq || !xCol || yCols.length === 0 ? (
            <Text color="gray.600">Select axes to render the chart.</Text>
          ) : chartType === "line" ? (
            <SimpleLineChart data={chartData} xKey={xCol} series={series} maWindow={maWindow} yAxisMode={yAxisMode} />
          ) : chartType === "derivative" ? (
            <SimpleLineChart data={computeDerivative(chartData, xCol, yCols)} xKey={xCol} series={series} maWindow={maWindow} yAxisMode={yAxisMode} />
          ) : chartType === "frequency" ? (
            <SimpleBarChart data={freqData} asPercent={freqAsPercent} />
          ) : null}
        </Box>
      </VStack>
    </Box>
  );
}

const COLORS = [
  "#319795", // teal.600
  "#DD6B20", // orange.500
  "#805AD5", // purple.500
  "#3182CE", // blue.600
  "#E53E3E", // red.500
  "#38A169", // green.500
];

function SimpleLineChart({ data, xKey, series, maWindow = 1, yAxisMode = "auto" }: { data: any[]; xKey: string; series: { name: string; color: string }[]; maWindow?: number; yAxisMode?: "auto" | "zeroToMax" }) {
  const width = 1000;
  const height = 360;
  const padding = { left: 50, right: 10, top: 10, bottom: 40 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const xs = data.map((d) => d?.[xKey]);
  const isNumericX = xs.every((v) => typeof v === "number" || (v != null && !isNaN(Number(v))));
  const xVals = isNumericX ? xs.map((v) => Number(v)) : xs.map((_, i) => i);
  const xMin = Math.min(...xVals);
  const xMax = Math.max(...xVals);
  const xScale = (v: number) => {
    if (xMax === xMin) return padding.left;
    return padding.left + ((v - xMin) / (xMax - xMin)) * plotW;
  };

  // Prepare Y arrays per series (optionally smoothed)
  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const rawYBySeries = new Map<string, number[]>();
  for (const s of series) rawYBySeries.set(s.name, data.map((d) => toNum(d?.[s.name])));
  const smooth = Math.max(1, Math.floor(maWindow));
  const win = smooth % 2 === 0 ? smooth + 1 : smooth; // ensure odd
  function movingAvg(arr: number[], window: number): number[] {
    if (window <= 1) return arr.slice();
    const k = Math.floor(window / 2);
    const out = new Array(arr.length).fill(NaN);
    for (let i = 0; i < arr.length; i++) {
      let sum = 0; let cnt = 0;
      for (let j = i - k; j <= i + k; j++) {
        if (j < 0 || j >= arr.length) continue;
        const v = arr[j];
        if (Number.isFinite(v)) { sum += v; cnt++; }
      }
      out[i] = cnt > 0 ? sum / cnt : NaN;
    }
    return out;
  }
  const yBySeries = new Map<string, number[]>();
  for (const s of series) yBySeries.set(s.name, movingAvg(rawYBySeries.get(s.name)!, win));

  // Determine Y domain
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const s of series) {
    const ys = yBySeries.get(s.name)!;
    for (const n of ys) {
      if (Number.isFinite(n)) {
        if (n < yMin) yMin = n;
        if (n > yMax) yMax = n;
      }
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
  if (yAxisMode === "zeroToMax") {
    // Clamp to [0, max*1.1]
    const maxOnly = Math.max(0, yMax);
    yMin = 0;
    yMax = maxOnly * 1.1;
    if (yMax === yMin) yMax = 1; // fallback
  } else {
    if (yMax === yMin) { yMin -= 1; yMax += 1; }
    const padY = (yMax - yMin) * 0.1;
    yMin -= padY;
    yMax += padY;
  }
  const yScale = (v: number) => padding.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const yTicks = 5;
  const yTickVals = Array.from({ length: yTicks }, (_, i) => yMin + ((yMax - yMin) * i) / (yTicks - 1));

  const xTickCount = Math.min(8, xVals.length);
  const xTickIdxs = (() => {
    if (xTickCount <= 1) return [0];
    if (isNumericX) {
      return Array.from({ length: xTickCount }, (_, i) =>
        Math.round((i * (xVals.length - 1)) / (xTickCount - 1))
      );
    }
    const count = Math.min(8, xs.length);
    if (count <= 1) return [0];
    return Array.from({ length: count }, (_, i) =>
      Math.round((i * (xs.length - 1)) / (count - 1))
    );
  })();

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="360">
      <rect x={padding.left} y={padding.top} width={plotW} height={plotH} fill="#ffffff" stroke="#E2E8F0" />
      {/* Grid + Y ticks */}
      {yTickVals.map((v, i) => {
        const y = yScale(v);
        return (
          <g key={`y${i}`}>
            <line x1={padding.left} x2={padding.left + plotW} y1={y} y2={y} stroke="#EDF2F7" />
            <text x={padding.left - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#4A5568">
              {Math.round(v * 100) / 100}
            </text>
          </g>
        );
      })}
      {/* X ticks */}
      {xTickIdxs.map((idx, i) => {
        const xv = xVals[idx];
        const x = xScale(xv);
        const label = isNumericX ? String(Math.round(xv * 100) / 100) : String(xs[idx]);
        return (
          <g key={`x${i}`}>
            <line x1={x} x2={x} y1={padding.top + plotH} y2={padding.top + plotH + 4} stroke="#A0AEC0" />
            <text x={x} y={padding.top + plotH + 16} textAnchor="middle" fontSize="10" fill="#4A5568">
              {label}
            </text>
          </g>
        );
      })}
      {/* Series lines */}
      {series.map((s) => {
        const pts: string[] = [];
        const ys = yBySeries.get(s.name)!;
        for (let i = 0; i < data.length; i++) {
          const xv = xVals[i];
          const yv = ys[i];
          if (!Number.isFinite(yv)) continue;
          const x = xScale(xv);
          const y = yScale(yv);
          pts.push(`${x},${y}`);
        }
        return <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={2} points={pts.join(" ")} />;
      })}
    </svg>
  );
}

function computeDerivative(data: any[], xKey: string, yCols: string[]) {
  if (!data || data.length === 0) return [] as any[];
  const out: any[] = [];
  for (let i = 0; i < data.length; i++) {
    const row: any = { [xKey]: data[i]?.[xKey] };
    if (i === 0) {
      for (const y of yCols) row[y] = NaN;
    } else {
      const x1 = Number(data[i - 1]?.[xKey]);
      const x2 = Number(data[i]?.[xKey]);
      const dx = x2 - x1;
      for (const y of yCols) {
        const y1 = Number(data[i - 1]?.[y]);
        const y2 = Number(data[i]?.[y]);
        const dy = y2 - y1;
        row[y] = Number.isFinite(dx) && dx !== 0 && Number.isFinite(dy) ? dy / dx : NaN;
      }
    }
    out.push(row);
  }
  return out;
}

function SimpleBarChart({ data, asPercent = false }: { data: { label: string; value: number }[]; asPercent?: boolean }) {
  const width = 1000;
  const height = 360;
  const padding = { left: 50, right: 10, top: 10, bottom: 70 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const n = data.length;
  const maxV = Math.max(1, ...data.map((d) => Number(d.value) || 0));
  const barW = n > 0 ? plotW / n : plotW;
  const yScale = (v: number) => padding.top + (1 - (v / maxV)) * plotH;
  const yTicks = 5;
  const yTickVals = Array.from({ length: yTicks }, (_, i) => (maxV * i) / (yTicks - 1));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="360">
      <rect x={padding.left} y={padding.top} width={plotW} height={plotH} fill="#ffffff" stroke="#E2E8F0" />
      {yTickVals.map((v, i) => {
        const y = yScale(v);
        return (
          <g key={`y${i}`}>
            <line x1={padding.left} x2={padding.left + plotW} y1={y} y2={y} stroke="#EDF2F7" />
            <text x={padding.left - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#4A5568">
              {asPercent ? `${Math.round((v * 100 + Number.EPSILON) ) / 100}%` : Math.round(v * 100) / 100}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = padding.left + i * barW + 2;
        const w = Math.max(0, barW - 4);
        const v = Number(d.value) || 0;
        const y = yScale(v);
        const h = padding.top + plotH - y;
        return (
          <g key={`b${i}`}>
            <rect x={x} y={y} width={w} height={h} fill={COLORS[0]} />
            <text x={x + w / 2} y={padding.top + plotH + 14} textAnchor="middle" fontSize="10" fill="#4A5568">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

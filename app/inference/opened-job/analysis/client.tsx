"use client";

import { Box, Heading, HStack, VStack, Text, Link, Badge, Select, CheckboxGroup, Checkbox, Separator, SkeletonText, Skeleton, createListCollection, Portal, Input, Button } from "@chakra-ui/react";
import NextLink from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { decodeBase64Utf8 } from "@/components/utils/base64";
import { getSignedObjectUrl } from "@/components/utils/minio";
import { cacheExists, readCachedBytes, downloadAndCacheBytes } from "@/components/utils/storage-cache";
import { useI18n } from "@/components/i18n/LanguageProvider";

type ChartType =
  | "line"
  | "derivative"

type LoadedParquet = {
  cols: string[]
  rows: any[]
}

// Numeric normalization helper (module-scope)
function toFiniteNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") {
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

  // Cache helpers are in storage-cache.ts; no OPFS-only code

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
        // fetch parquet bytes (prefer browser cache)
        let fileBuf: Uint8Array;
        try {
          if (await cacheExists(bucket, key)) {
            fileBuf = (await readCachedBytes(bucket, key)) || new Uint8Array(0);
            if (!fileBuf || fileBuf.length === 0) throw new Error("empty cache");
          } else {
            const url = await getSignedObjectUrl(bucket, key, 60 * 10);
            const resp = await fetch(url);
            fileBuf = new Uint8Array(await resp.arrayBuffer());
            // best-effort: populate cache for next time
            try { await downloadAndCacheBytes(bucket, key); } catch { /* ignore */ }
          }
        } catch {
          fileBuf = await downloadAndCacheBytes(bucket, key);
        }
        await db.registerFileBuffer("current.parquet", fileBuf);
        const res: any = await conn.query(`SELECT * FROM read_parquet('current.parquet')`);
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
  const [logY, setLogY] = useState<boolean>(false);
  // Row filter expression (set/logic based)
  const [rowFilterExpr, setRowFilterExpr] = useState<string>("");
  const [rowFilterError, setRowFilterError] = useState<string | null>(null);
  // Helper defined at module scope
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pq, numericCols]);

  // Build row-filter predicate from expression
  const rowFilter = useMemo(() => {
    const expr = rowFilterExpr?.trim() || "";
    if (!expr) { setRowFilterError(null); return (r: any) => { void r; return true; }; }
    try {
      const pred = buildFilterPredicate(expr);
      setRowFilterError(null);
      return pred;
    } catch (e: any) {
      setRowFilterError(String(e?.message || e));
      return (r: any) => { void r; return true; };
    }
  }, [rowFilterExpr]);

  // Prepare chart data and series (sorted + optional downsampling for very large datasets)
  const chartData = useMemo(() => {
    if (!pq || !xCol) return [];
    const rows = pq.rows;
    const out: any[] = [];
    for (const r of rows) {
      if (!rowFilter(r)) continue;
      const xv = toFiniteNumber(r?.[xCol]);
      if (xv == null) continue; // require numeric X
      const obj: any = { [xCol]: xv };
      for (const y of yCols) {
        const yv = toFiniteNumber(r?.[y]);
        obj[y] = yv == null ? NaN : yv;
      }
      out.push(obj);
    }
    // sort by X ascending
    out.sort((a, b) => (a[xCol] as number) - (b[xCol] as number));
    // downsample to keep performance on 1M+ rows
    const MAX_POINTS = 2000; // per chart, approximate
    if (out.length <= MAX_POINTS) return out;
    return downsampleBins(out, xCol, yCols, MAX_POINTS);
  }, [pq, xCol, yCols, rowFilter]);

  const series = useMemo(() => yCols.map((name, i) => ({ name, color: COLORS[i % COLORS.length] })), [yCols]);

  // No X Range restriction; render entire domain

  const chartTypeItems = useMemo(() => ([
    { label: t("chart.type.line", "Line"), value: "line" },
    { label: t("chart.type.derivative", "Derivative"), value: "derivative" },
  ]), [t]);

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
              collection={createListCollection({ items: chartTypeItems })}
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
                    {chartTypeItems.map((it) => (
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
          <VStack align="stretch" minW="420px">
            <Text textStyle="sm" color="gray.600">Filter (rows)</Text>
            <HStack gap="8px">
              <Input size="sm" flex={1} value={rowFilterExpr} onChange={(e) => setRowFilterExpr(e.target.value)}
                placeholder={"e.g. status ∈ {ok,err} ∧ score ≥ 0.8 ∪ tag = \"test\""} />
              <Button size="xs" variant="outline" onClick={() => setRowFilterExpr("")}>Clear</Button>
            </HStack>
            {rowFilterError ? <Text textStyle="xs" color="red.500">{rowFilterError}</Text> : (
              <Text textStyle="xs" color="gray.500">Supports =, ≠, ≥, ≤, &gt;, &lt;, ∈, ∉, ~, !~, ∧/∩//\\ (AND), ∨/∪/\\/ (OR), !/¬/~ (NOT); parentheses, sets {'{a,b}'}; works across all column types. Use '~' between field and value for contains, and leading '~' as TLA+ NOT.</Text>
            )}
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
          {(chartType === "line" || chartType === "derivative") && (
          <VStack align="stretch" minW="180px">
            <Text textStyle="sm" color="gray.600">Log Y</Text>
            <Checkbox.Root checked={logY} onCheckedChange={(e: any) => setLogY(!!(e?.checked ?? e))}>
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>Use log scale</Checkbox.Label>
            </Checkbox.Root>
          </VStack>
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
            <SimpleLineChart data={chartData} xKey={xCol} series={series} maWindow={maWindow} yAxisMode={yAxisMode} logY={logY} />
          ) : chartType === "derivative" ? (
            <SimpleLineChart data={computeDerivative(chartData, xCol, yCols)} xKey={xCol} series={series} maWindow={maWindow} yAxisMode={yAxisMode} logY={logY} />
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

function SimpleLineChart({ data, xKey, series, maWindow = 1, yAxisMode = "auto", logY = false }: { data: any[]; xKey: string; series: { name: string; color: string }[]; maWindow?: number; yAxisMode?: "auto" | "zeroToMax"; logY?: boolean }) {
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
  // Optional log scale on Y
  let yScale: (v: number) => number;
  if (logY) {
    const safeMin = Math.max(Number.MIN_VALUE, yMin > 0 ? yMin : Number.MIN_VALUE);
    const syMin = Math.log10(safeMin);
    const syMax = Math.log10(Math.max(safeMin * 10, yMax));
    yScale = (v: number) => {
      const val = v <= 0 ? safeMin : v;
      const t = (Math.log10(val) - syMin) / Math.max(1e-12, (syMax - syMin));
      return padding.top + (1 - t) * plotH;
    };
  } else {
    yScale = (v: number) => padding.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  }

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

// Downsample huge line-series by binning and averaging values per bin
function downsampleBins(data: any[], xKey: string, yCols: string[], maxPoints: number) {
  const n = data.length;
  if (n <= maxPoints) return data;
  const bins = Math.max(1, Math.min(maxPoints, n));
  const binSize = n / bins;
  const out: any[] = [];
  for (let b = 0; b < bins; b++) {
    const start = Math.floor(b * binSize);
    const end = Math.min(n, Math.floor((b + 1) * binSize));
    if (end <= start) continue;
    let xSum = 0; let cnt = 0;
    const ySum: Record<string, number> = {};
    const yCnt: Record<string, number> = {};
    for (const y of yCols) { ySum[y] = 0; yCnt[y] = 0; }
    for (let i = start; i < end; i++) {
      const row = data[i];
      const xv = Number(row?.[xKey]);
      if (Number.isFinite(xv)) { xSum += xv; cnt++; }
      for (const y of yCols) {
        const v = Number(row?.[y]);
        if (Number.isFinite(v)) { ySum[y] += v; yCnt[y]++; }
      }
    }
    const xAvg = cnt > 0 ? xSum / cnt : Number(data[Math.floor((start + end) / 2)]?.[xKey]) || 0;
    const obj: any = { [xKey]: xAvg };
    for (const y of yCols) {
      obj[y] = yCnt[y] > 0 ? (ySum[y] / yCnt[y]) : NaN;
    }
    out.push(obj);
  }
  return out;
}

// ---------------- Row filter expression parser ----------------
// Supports:
// - Comparators: =, ==, ≠, !=, ≥, >=, ≤, <=, >, <
// - Membership: ∈, in, ∉, not in
// - Substring: ~, !~ (case-insensitive contains)
// - Logic: ∧, ∩, and, && (AND); ∨, ∪, or, || (OR); !, ¬, not (NOT)
// - Parentheses and set literals: {a, b, 3, "x"}
// - Works across numbers, strings, booleans, null
type Tok = { type: string; value?: any };
function tokenizeFilter(input: string): Tok[] {
  const s = input;
  const toks: Tok[] = [];
  let i = 0;
  const isWS = (c: string) => /\s/.test(c);
  const peek = () => s[i];
  const next = () => s[i++];
  function readWhile(fn: (c: string) => boolean) {
    let out = "";
    while (i < s.length && fn(s[i])) out += s[i++];
    return out;
  }
  function matchAhead(str: string) { return s.slice(i, i + str.length) === str; }
  function pushOp(op: string) { toks.push({ type: op }); }
  while (i < s.length) {
    const c = peek();
    if (isWS(c)) { next(); continue; }
    // punctuation
    if (c === '(') { toks.push({ type: 'LP' }); next(); continue; }
    if (c === ')') { toks.push({ type: 'RP' }); next(); continue; }
    if (c === '{') { toks.push({ type: 'LB' }); next(); continue; }
    if (c === '}') { toks.push({ type: 'RB' }); next(); continue; }
    if (c === ',') { toks.push({ type: 'COMMA' }); next(); continue; }
    // multi-char operators and unicode
    // TLA+ style logic tokens
    if (matchAhead('/\\')) { i += 2; pushOp('AND'); continue; }
    if (matchAhead('\\/')) { i += 2; pushOp('OR'); continue; }
    if (matchAhead('not in')) { i += 6; pushOp('NIN'); continue; }
    if (matchAhead('NOT IN')) { i += 6; pushOp('NIN'); continue; }
    if (matchAhead('!=')) { i += 2; pushOp('NE'); continue; }
    if (matchAhead('==')) { i += 2; pushOp('EQ'); continue; }
    if (matchAhead('>=')) { i += 2; pushOp('GTE'); continue; }
    if (matchAhead('<=')) { i += 2; pushOp('LTE'); continue; }
    if (matchAhead('!~')) { i += 2; pushOp('NCONTAINS'); continue; }
    if (matchAhead('&&')) { i += 2; pushOp('AND'); continue; }
    if (matchAhead('||')) { i += 2; pushOp('OR'); continue; }
    if (matchAhead('!in')) { i += 3; pushOp('NIN'); continue; }
    if (matchAhead('notin')) { i += 5; pushOp('NIN'); continue; }
    // single char ops and unicode variants
    if (c === '=') { next(); pushOp('EQ'); continue; }
    if (c === '>') { next(); pushOp('GT'); continue; }
    if (c === '<') { next(); pushOp('LT'); continue; }
    if (c === '!') { next(); pushOp('NOT'); continue; }
    if (c === '~') { next(); pushOp('TILDE'); continue; }
    if (c === '∈') { next(); pushOp('IN'); continue; }
    if (c === '∉') { next(); pushOp('NIN'); continue; }
    if (c === '≥') { next(); pushOp('GTE'); continue; }
    if (c === '≤') { next(); pushOp('LTE'); continue; }
    if (c === '≠') { next(); pushOp('NE'); continue; }
    if (c === '∧' || c === '∩') { next(); pushOp('AND'); continue; }
    if (c === '∨' || c === '∪') { next(); pushOp('OR'); continue; }
    if (c === '¬') { next(); pushOp('NOT'); continue; }
    // quoted strings (single, double, backtick)
    if (c === '"' || c === '\'' || c === '`') {
      const q = next();
      let out = "";
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\' && i + 1 < s.length) { out += s[i + 1]; i += 2; }
        else { out += s[i++]; }
      }
      if (i >= s.length) throw new Error('Unclosed string literal');
      next();
      toks.push({ type: 'STRING', value: out });
      continue;
    }
    // identifiers, keywords, numbers
    const word = readWhile((ch) => !isWS(ch) && !'(){} ,<>=!~'.includes(ch));
    if (word.length === 0) { // fallback to single char (unexpected)
      toks.push({ type: 'CHAR', value: next() });
      continue;
    }
    const lower = word.toLowerCase();
    if (lower === 'and') { pushOp('AND'); continue; }
    if (lower === 'or') { pushOp('OR'); continue; }
    if (lower === 'not') { pushOp('NOT'); continue; }
    if (lower === 'in') { pushOp('IN'); continue; }
    if (lower === 'true' || lower === 'false') { toks.push({ type: 'BOOL', value: lower === 'true' }); continue; }
    if (lower === 'null' || lower === 'nil' || lower === 'none') { toks.push({ type: 'NULL', value: null }); continue; }
    // number?
    const num = Number(word);
    if (!Number.isNaN(num) && /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(word)) { toks.push({ type: 'NUMBER', value: num }); continue; }
    // identifier (column name)
    toks.push({ type: 'IDENT', value: word });
  }
  return toks;
}

function buildFilterPredicate(expr: string): (row: any) => boolean {
  const toks = tokenizeFilter(expr);
  let i = 0;
  const peek = () => toks[i];
  const eat = (type?: string) => {
    const t = toks[i];
    if (!t) return undefined as any;
    if (!type || t.type === type) { i++; return t; }
    return undefined as any;
  };
  function parseValue(): any {
    const t = peek();
    if (!t) throw new Error('Unexpected end');
    if (t.type === 'NUMBER' || t.type === 'STRING' || t.type === 'BOOL' || t.type === 'NULL') { i++; return t.value; }
    // bare identifier as string value
    if (t.type === 'IDENT') { i++; return String(t.value); }
    throw new Error('Expected value');
  }
  function parseSet(): any[] {
    if (!eat('LB')) throw new Error('Expected {');
    const arr: any[] = [];
    while (i < toks.length && peek()?.type !== 'RB') {
      arr.push(parseValue());
      if (peek()?.type === 'COMMA') eat('COMMA');
    }
    if (!eat('RB')) throw new Error('Expected }');
    return arr;
  }
  function eqVal(a: any, b: any): boolean {
    const na = toFiniteNumber(a); const nb = toFiniteNumber(b);
    if (na != null && nb != null) return na === nb;
    if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
    if (a == null && b == null) return true;
    return String(a) === String(b);
  }
  function cmpNum(op: 'GT'|'GTE'|'LT'|'LTE', a: any, b: any): boolean {
    const na = toFiniteNumber(a); const nb = toFiniteNumber(b);
    if (na == null || nb == null) return false;
    if (op === 'GT') return na > nb;
    if (op === 'GTE') return na >= nb;
    if (op === 'LT') return na < nb;
    return na <= nb;
  }
  function contains(a: any, b: any): boolean {
    if (a == null || b == null) return false;
    const sa = String(a).toLowerCase();
    const sb = String(b).toLowerCase();
    return sa.includes(sb);
  }
  function parsePrimary(): (row: any) => boolean {
    const t = peek();
    if (!t) throw new Error('Unexpected end');
    if (t.type === 'LP') { eat('LP'); const e = parseOr(); if (!eat('RP')) throw new Error('Expected )'); return e; }
    // comparison: IDENT op value | IDENT IN set | IDENT ~ value
    if (t.type === 'IDENT' || t.type === 'STRING') {
      const identTok = eat(t.type);
      const key = String(identTok!.value);
      const opTok = peek();
      if (!opTok) throw new Error('Missing operator after ' + key);
      const op = opTok.type; i++;
      if (op === 'IN' || op === 'NIN') {
        const arr = parseSet();
        return (row: any) => {
          const v = row?.[key];
          const inSet = arr.some((x) => eqVal(v, x));
          return op === 'IN' ? inSet : !inSet;
        };
      }
      if (op === 'TILDE' || op === 'NCONTAINS') {
        const val = parseValue();
        return (row: any) => {
          const v = row?.[key];
          const ok = contains(v, val);
          return op === 'TILDE' ? ok : !ok;
        };
      }
      if (['EQ','NE','GT','GTE','LT','LTE'].includes(op)) {
        const val = parseValue();
        return (row: any) => {
          const v = row?.[key];
          let res = false;
          if (op === 'EQ') res = eqVal(v, val);
          else if (op === 'NE') res = !eqVal(v, val);
          else res = cmpNum(op as any, v, val);
          return res;
        };
      }
      throw new Error('Unsupported operator: ' + op);
    }
    throw new Error('Expected identifier or (')
  }
  function parseNot(): (row: any) => boolean {
    const t = peek();
    if (t && (t.type === 'NOT' || t.type === 'TILDE')) { eat(t.type); const e = parseNot(); return (r) => !e(r); }
    return parsePrimary();
  }
  function parseAnd(): (row: any) => boolean {
    let left = parseNot();
    while (peek() && peek()!.type === 'AND') { eat('AND'); const right = parseNot(); const l = left; left = (r) => l(r) && right(r); }
    return left;
  }
  function parseOr(): (row: any) => boolean {
    let left = parseAnd();
    while (peek() && peek()!.type === 'OR') { eat('OR'); const right = parseAnd(); const l = left; left = (r) => l(r) || right(r); }
    return left;
  }
  const pred = parseOr();
  if (i < toks.length) throw new Error('Unexpected token');
  return pred;
}

// Removed other chart helpers for simplicity (only line/derivative remain)

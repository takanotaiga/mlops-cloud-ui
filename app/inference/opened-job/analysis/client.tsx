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
  | "frequency"
  | "derivative"
  | "histogram"
  | "cdf"
  | "ccdf"
  | "scatter"
  | "correlation"
  | "cumsum"
  | "pctchange"
  | "missing"

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
  const [logY, setLogY] = useState<boolean>(false);
  // X-axis filter (for line/derivative)
  const [xFilterMin, setXFilterMin] = useState<string>("");
  const [xFilterMax, setXFilterMax] = useState<string>("");
  const [freqCol, setFreqCol] = useState<string>("");
  const [freqTopN, setFreqTopN] = useState<number>(20);
  const [freqAsPercent, setFreqAsPercent] = useState<boolean>(false);
  // Histogram/CDF/CCDF
  const [histCol, setHistCol] = useState<string>("");
  const [histBins, setHistBins] = useState<number>(20);
  const [histAsPercent, setHistAsPercent] = useState<boolean>(false);
  const [cdfCol, setCdfCol] = useState<string>("");
  const [ccdfCol, setCcdfCol] = useState<string>("");
  // Scatter
  const [scatterX, setScatterX] = useState<string>("");
  const [scatterY, setScatterY] = useState<string>("");
  const [scatterTrend, setScatterTrend] = useState<boolean>(true);
  const [logX, setLogX] = useState<boolean>(false);
  // Correlation
  const [corrCols, setCorrCols] = useState<string[]>([]);
  // Percent change
  const [pctMode, setPctMode] = useState<"prev" | "first">("prev");
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
    if (!freqCol && (pq?.cols?.length ?? 0) > 0) {
      setFreqCol(pq!.cols[0]!);
    }
    if (!histCol && numericCols.length > 0) setHistCol(numericCols[0]!);
    if (!cdfCol && numericCols.length > 0) setCdfCol(numericCols[0]!);
    if (!ccdfCol && numericCols.length > 0) setCcdfCol(numericCols[0]!);
    if (!scatterX && numericCols.length > 1) setScatterX(numericCols[0]!);
    if (!scatterY && numericCols.length > 1) setScatterY(numericCols[1]!);
    if (corrCols.length === 0 && numericCols.length > 0) setCorrCols(numericCols.slice(0, Math.min(8, numericCols.length)));
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

  // X domain for current xCol
  const xDomain = useMemo(() => {
    if (!pq || !xCol) return { min: 0, max: 1, ready: false };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const r of pq.rows) {
      const v = toFiniteNumber(r?.[xCol]);
      if (v == null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ready: false };
    if (max === min) { max = min + 1; }
    return { min, max, ready: true };
  }, [pq, xCol]);

  // Initialize filter to domain when xCol/domain changes
  useEffect(() => {
    if (!xDomain.ready) return;
    setXFilterMin(String(xDomain.min));
    setXFilterMax(String(xDomain.max));
  }, [xDomain.min, xDomain.max, xDomain.ready]);

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

  const chartTypeItems = useMemo(() => ([
    { label: t("chart.type.line", "Line"), value: "line" },
    { label: t("chart.type.frequency", "Frequency"), value: "frequency" },
    { label: t("chart.type.derivative", "Derivative"), value: "derivative" },
    { label: t("chart.type.histogram", "Histogram"), value: "histogram" },
    { label: t("chart.type.cdf", "CDF"), value: "cdf" },
    { label: t("chart.type.ccdf", "CCDF"), value: "ccdf" },
    { label: t("chart.type.scatter", "Scatter"), value: "scatter" },
    { label: t("chart.type.correlation", "Correlation"), value: "correlation" },
    { label: t("chart.type.cumsum", "Cumulative Sum"), value: "cumsum" },
    { label: t("chart.type.pctchange", "% Change"), value: "pctchange" },
    { label: t("chart.type.missing", "Missing Profile"), value: "missing" },
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
          <VStack align="stretch" minW="300px">
            <Text textStyle="sm" color="gray.600">X Range</Text>
            <HStack>
              <Input size="sm" width="120px" type="number" value={xFilterMin}
                onChange={(e) => setXFilterMin(e.target.value)} placeholder={xDomain.ready ? String(xDomain.min) : "min"} />
              <Text>~</Text>
              <Input size="sm" width="120px" type="number" value={xFilterMax}
                onChange={(e) => setXFilterMax(e.target.value)} placeholder={xDomain.ready ? String(xDomain.max) : "max"} />
              <Button size="xs" variant="outline" onClick={() => { if (xDomain.ready) { setXFilterMin(String(xDomain.min)); setXFilterMax(String(xDomain.max)); } }}>Reset</Button>
            </HStack>
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
          {chartType === "histogram" && (
            <>
              <VStack align="stretch" minW="240px">
                <Text textStyle="sm" color="gray.600">Column</Text>
                <Select.Root size="sm" width="100%"
                  collection={createListCollection({ items: numericCols.map((c) => ({ label: c, value: c })) })}
                  value={histCol ? [histCol] : []}
                  onValueChange={(d: any) => setHistCol(d?.value?.[0] ?? "")}
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
              <VStack align="stretch" minW="160px">
                <Text textStyle="sm" color="gray.600">Bins</Text>
                <Select.Root size="sm" width="100%"
                  collection={createListCollection({ items: [10,20,30,50].map((n) => ({ label: String(n), value: String(n) })) })}
                  value={[String(histBins)]}
                  onValueChange={(d: any) => setHistBins(Number(d?.value?.[0] ?? "20"))}
                >
                  <Select.HiddenSelect />
                  <Select.Control>
                    <Select.Trigger>
                      <Select.ValueText placeholder="Bin count" />
                    </Select.Trigger>
                    <Select.IndicatorGroup>
                      <Select.Indicator />
                    </Select.IndicatorGroup>
                  </Select.Control>
                  <Portal>
                    <Select.Positioner>
                      <Select.Content>
                        {[10,20,30,50].map((n) => (
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
                <Checkbox.Root checked={histAsPercent} onCheckedChange={(e: any) => setHistAsPercent(!!(e?.checked ?? e))}>
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                  <Checkbox.Label>Show as percentage</Checkbox.Label>
                </Checkbox.Root>
              </VStack>
            </>
          )}
          {(chartType === "cdf" || chartType === "ccdf") && (
            <VStack align="stretch" minW="240px">
              <Text textStyle="sm" color="gray.600">Column</Text>
              <Select.Root size="sm" width="100%"
                collection={createListCollection({ items: numericCols.map((c) => ({ label: c, value: c })) })}
                value={chartType === "cdf" ? (cdfCol ? [cdfCol] : []) : (ccdfCol ? [ccdfCol] : [])}
                onValueChange={(d: any) => (chartType === "cdf" ? setCdfCol : setCcdfCol)(d?.value?.[0] ?? "")}
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
          {chartType === "scatter" && (
            <>
              <VStack align="stretch" minW="220px">
                <Text textStyle="sm" color="gray.600">X</Text>
                <Select.Root size="sm" width="100%"
                  collection={createListCollection({ items: numericCols.map((c) => ({ label: c, value: c })) })}
                  value={scatterX ? [scatterX] : []}
                  onValueChange={(d: any) => setScatterX(d?.value?.[0] ?? "")}
                >
                  <Select.HiddenSelect />
                  <Select.Control><Select.Trigger><Select.ValueText placeholder="X" /></Select.Trigger><Select.IndicatorGroup><Select.Indicator /></Select.IndicatorGroup></Select.Control>
                  <Portal><Select.Positioner><Select.Content>
                    {numericCols.map((c) => (<Select.Item key={c} item={{ label: c, value: c }}>{c}<Select.ItemIndicator /></Select.Item>))}
                  </Select.Content></Select.Positioner></Portal>
                </Select.Root>
              </VStack>
              <VStack align="stretch" minW="220px">
                <Text textStyle="sm" color="gray.600">Y</Text>
                <Select.Root size="sm" width="100%"
                  collection={createListCollection({ items: numericCols.map((c) => ({ label: c, value: c })) })}
                  value={scatterY ? [scatterY] : []}
                  onValueChange={(d: any) => setScatterY(d?.value?.[0] ?? "")}
                >
                  <Select.HiddenSelect />
                  <Select.Control><Select.Trigger><Select.ValueText placeholder="Y" /></Select.Trigger><Select.IndicatorGroup><Select.Indicator /></Select.IndicatorGroup></Select.Control>
                  <Portal><Select.Positioner><Select.Content>
                    {numericCols.map((c) => (<Select.Item key={c} item={{ label: c, value: c }}>{c}<Select.ItemIndicator /></Select.Item>))}
                  </Select.Content></Select.Positioner></Portal>
                </Select.Root>
              </VStack>
              <VStack align="stretch" minW="160px">
                <Text textStyle="sm" color="gray.600">Trendline</Text>
                <Checkbox.Root checked={scatterTrend} onCheckedChange={(e: any) => setScatterTrend(!!(e?.checked ?? e))}>
                  <Checkbox.HiddenInput /><Checkbox.Control /><Checkbox.Label>Show OLS</Checkbox.Label>
                </Checkbox.Root>
              </VStack>
              <VStack align="stretch" minW="180px">
                <Text textStyle="sm" color="gray.600">Log Scale</Text>
                <Checkbox.Root checked={logX} onCheckedChange={(e: any) => setLogX(!!(e?.checked ?? e))}>
                  <Checkbox.HiddenInput /><Checkbox.Control /><Checkbox.Label>Log X</Checkbox.Label>
                </Checkbox.Root>
                <Checkbox.Root checked={logY} onCheckedChange={(e: any) => setLogY(!!(e?.checked ?? e))}>
                  <Checkbox.HiddenInput /><Checkbox.Control /><Checkbox.Label>Log Y</Checkbox.Label>
                </Checkbox.Root>
              </VStack>
            </>
          )}
          {chartType === "correlation" && (
            <VStack align="stretch" minW="280px">
              <Text textStyle="sm" color="gray.600">Columns</Text>
              <CheckboxGroup value={corrCols} onValueChange={(v: any) => setCorrCols((v?.value ?? v) as string[])}>
                <VStack align="stretch" h="140px" overflowY="auto" borderWidth="1px" rounded="md" p="8px" bg="bg.panel" style={{ scrollbarGutter: "stable both-edges" }}>
                  {numericCols.map((c) => (
                    <Checkbox.Root key={c} value={c}>
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                      <Checkbox.Label>{c}</Checkbox.Label>
                    </Checkbox.Root>
                  ))}
                </VStack>
              </CheckboxGroup>
            </VStack>
          )}
          {chartType === "pctchange" && (
            <VStack align="stretch" minW="200px">
              <Text textStyle="sm" color="gray.600">Baseline</Text>
              <Select.Root size="sm" width="100%"
                collection={createListCollection({ items: [
                  { label: "Previous", value: "prev" },
                  { label: "First", value: "first" },
                ] })}
                value={[pctMode]}
                onValueChange={(d: any) => setPctMode(((d?.value?.[0] ?? "prev") as any))}
              >
                <Select.HiddenSelect />
                <Select.Control><Select.Trigger><Select.ValueText placeholder="Baseline" /></Select.Trigger><Select.IndicatorGroup><Select.Indicator /></Select.IndicatorGroup></Select.Control>
                <Portal><Select.Positioner><Select.Content>
                  {[{label:"Previous",value:"prev"},{label:"First",value:"first"}].map((it) => (
                    <Select.Item key={it.value} item={it}>{it.label}<Select.ItemIndicator /></Select.Item>
                  ))}
                </Select.Content></Select.Positioner></Portal>
              </Select.Root>
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
            <SimpleLineChart data={applyXFilter(chartData, xCol, xFilterMin, xFilterMax, xDomain)} xKey={xCol} series={series} maWindow={maWindow} yAxisMode={yAxisMode} logY={logY} />
          ) : chartType === "derivative" ? (
            <SimpleLineChart data={computeDerivative(applyXFilter(chartData, xCol, xFilterMin, xFilterMax, xDomain), xCol, yCols)} xKey={xCol} series={series} maWindow={maWindow} yAxisMode={yAxisMode} logY={logY} />
          ) : chartType === "frequency" ? (
            <SimpleBarChart data={freqData} asPercent={freqAsPercent} />
          ) : chartType === "histogram" ? (
            <SimpleHistogramChart values={(pq?.rows ?? []).map((r) => toFiniteNumber(r?.[histCol])) as (number|null)[]} bins={histBins} asPercent={histAsPercent} />
          ) : chartType === "cdf" ? (
            <SimpleLineChart data={computeCdfLike((pq?.rows ?? []).map((r) => toFiniteNumber(r?.[cdfCol])) as (number|null)[], false)} xKey={"value"} series={[{ name: "cdf", color: COLORS[0] }]} maWindow={1} yAxisMode={"auto"} />
          ) : chartType === "ccdf" ? (
            <SimpleLineChart data={computeCdfLike((pq?.rows ?? []).map((r) => toFiniteNumber(r?.[ccdfCol])) as (number|null)[], true)} xKey={"value"} series={[{ name: "ccdf", color: COLORS[0] }]} maWindow={1} yAxisMode={"auto"} />
          ) : chartType === "scatter" ? (
            <SimpleScatterChart data={pq?.rows ?? []} xKey={scatterX} yKey={scatterY} logX={logX} logY={logY} trendline={scatterTrend} />
          ) : chartType === "correlation" ? (
            <SimpleCorrelationHeatmap data={pq?.rows ?? []} cols={corrCols} />
          ) : chartType === "cumsum" ? (
            <SimpleLineChart data={computeCumSum(chartData, xCol, yCols)} xKey={xCol} series={series} maWindow={1} yAxisMode={"auto"} />
          ) : chartType === "pctchange" ? (
            <SimpleLineChart data={computePctChange(chartData, xCol, yCols, pctMode)} xKey={xCol} series={series} maWindow={1} yAxisMode={"auto"} />
          ) : chartType === "missing" ? (
            <SimpleBarChart data={computeMissingProfile(pq)} asPercent={true} />
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

function applyXFilter(data: any[], xKey: string, minStr: string, maxStr: string, domain: { min: number; max: number; ready: boolean }) {
  if (!Array.isArray(data) || data.length === 0) return data;
  const minParsed = Number(minStr);
  const maxParsed = Number(maxStr);
  const min = Number.isFinite(minParsed) ? minParsed : (domain.ready ? domain.min : Number.NEGATIVE_INFINITY);
  const max = Number.isFinite(maxParsed) ? maxParsed : (domain.ready ? domain.max : Number.POSITIVE_INFINITY);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return data.filter((r) => {
    const xv = Number(r?.[xKey]);
    return Number.isFinite(xv) && xv >= lo && xv <= hi;
  });
}

function computeCumSum(data: any[], xKey: string, yCols: string[]) {
  const out: any[] = [];
  const sums: Record<string, number> = {};
  for (const y of yCols) sums[y] = 0;
  for (const r of data) {
    const row: any = { [xKey]: r?.[xKey] };
    for (const y of yCols) {
      const n = Number(r?.[y]);
      if (Number.isFinite(n)) sums[y] += n;
      row[y] = Number.isFinite(sums[y]) ? sums[y] : NaN;
    }
    out.push(row);
  }
  return out;
}

function computePctChange(data: any[], xKey: string, yCols: string[], mode: "prev" | "first") {
  const out: any[] = [];
  const base: Record<string, number> = {};
  for (const r of data) {
    const row: any = { [xKey]: r?.[xKey] };
    for (const y of yCols) {
      const n = Number(r?.[y]);
      if (!Number.isFinite(n)) { row[y] = NaN; continue; }
      if (mode === "first") {
        if (!Number.isFinite(base[y])) base[y] = n;
        const b = base[y];
        row[y] = b === 0 ? NaN : ((n - b) / Math.abs(b)) * 100;
      } else {
        const b = Number.isFinite(base[y]) ? base[y] : n;
        row[y] = b === 0 ? NaN : ((n - b) / Math.abs(b)) * 100;
        base[y] = n;
      }
    }
    out.push(row);
  }
  return out;
}

function computeMissingProfile(pq: LoadedParquet | null): { label: string; value: number }[] {
  if (!pq) return [];
  const total = pq.rows.length;
  return (pq.cols || []).map((c) => {
    let missing = 0;
    for (const r of pq.rows) {
      const v = r?.[c];
      if (v == null || (typeof v === "number" && !Number.isFinite(v))) missing++;
      else if (typeof v === "string" && (v.trim() === "" || v.toLowerCase() === "nan")) missing++;
    }
    return { label: c, value: total === 0 ? 0 : (missing / total) };
  });
}

function computeCdfLike(values: (number | null)[], ccdf: boolean) {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a,b)=>a-b);
  const n = xs.length;
  const data: any[] = [];
  for (let i = 0; i < n; i++) {
    const v = xs[i];
    const frac = (i + 1) / n;
    data.push({ value: v, [ccdf ? "ccdf" : "cdf"]: ccdf ? (1 - frac) : frac });
  }
  return data;
}

function SimpleHistogramChart({ values, bins = 20, asPercent = false }: { values: (number | null)[]; bins?: number; asPercent?: boolean }) {
  const width = 1000; const height = 360;
  const padding = { left: 50, right: 10, top: 10, bottom: 40 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (xs.length === 0) return <Text>No numeric data</Text> as any;
  const min = Math.min(...xs); let max = Math.max(...xs);
  if (max === min) { max = min + 1; }
  const bw = (max - min) / Math.max(1, bins);
  const counts = new Array(bins).fill(0);
  for (const v of xs) {
    let idx = Math.floor((v - min) / bw);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  const total = xs.length;
  const vals = counts.map((c) => (asPercent ? c / total : c));
  const vmax = Math.max(1e-9, ...vals);
  const yScale = (v: number) => padding.top + (1 - v / vmax) * plotH;
  const xScale = (i: number) => padding.left + (i / bins) * plotW;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="360">
      <rect x={padding.left} y={padding.top} width={plotW} height={plotH} fill="#ffffff" stroke="#E2E8F0" />
      {counts.map((_, i) => {
        const v = vals[i];
        const x = xScale(i);
        const w = plotW / bins - 2;
        const y = yScale(v);
        const h = padding.top + plotH - y;
        return <rect key={i} x={x + 1} y={y} width={w} height={h} fill={COLORS[0]} />;
      })}
      <text x={padding.left} y={height - 10} fontSize="10" fill="#4A5568">{`min ${Math.round(min*100)/100}`}</text>
      <text x={padding.left + plotW} y={height - 10} fontSize="10" fill="#4A5568" textAnchor="end">{`max ${Math.round(max*100)/100}`}</text>
    </svg>
  );
}

function SimpleScatterChart({ data, xKey, yKey, logX = false, logY = false, trendline = true }: { data: any[]; xKey: string; yKey: string; logX?: boolean; logY?: boolean; trendline?: boolean }) {
  const width = 1000; const height = 360;
  const padding = { left: 50, right: 10, top: 10, bottom: 40 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const pts = data.map((r) => ({ x: toFiniteNumber(r?.[xKey]), y: toFiniteNumber(r?.[yKey]) })).filter((p) => p.x != null && p.y != null) as {x:number;y:number}[];
  if (pts.length === 0) return <Text>No numeric data</Text> as any;
  const xVals = pts.map(p=>p.x);
  const yVals = pts.map(p=>p.y);
  const xMin0 = Math.min(...xVals), xMax0 = Math.max(...xVals);
  const yMin0 = Math.min(...yVals), yMax0 = Math.max(...yVals);
  const lxMin = logX ? Math.log10(Math.max(Number.MIN_VALUE, xMin0 > 0 ? xMin0 : Number.MIN_VALUE)) : xMin0;
  const lxMax = logX ? Math.log10(Math.max(Number.MIN_VALUE*10, xMax0)) : xMax0;
  const lyMin = logY ? Math.log10(Math.max(Number.MIN_VALUE, yMin0 > 0 ? yMin0 : Number.MIN_VALUE)) : yMin0;
  const lyMax = logY ? Math.log10(Math.max(Number.MIN_VALUE*10, yMax0)) : yMax0;
  const scaleX = (v: number) => {
    const val = logX ? Math.log10(v <= 0 ? Number.MIN_VALUE : v) : v;
    return padding.left + ((val - lxMin) / Math.max(1e-12, (lxMax - lxMin))) * plotW;
  };
  const scaleY = (v: number) => {
    const val = logY ? Math.log10(v <= 0 ? Number.MIN_VALUE : v) : v;
    return padding.top + (1 - (val - lyMin) / Math.max(1e-12, (lyMax - lyMin))) * plotH;
  };
  // OLS fit y = a + b x (in linear space, not log)
  let ols: { a: number; b: number } | null = null;
  if (trendline && pts.length >= 2) {
    let sx=0, sy=0, sxx=0, sxy=0; const n=pts.length;
    for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x*p.x; sxy += p.x*p.y; }
    const denom = (n*sxx - sx*sx);
    if (Math.abs(denom) > 1e-12) {
      const b = (n*sxy - sx*sy) / denom;
      const a = (sy - b*sx) / n;
      ols = { a, b };
    }
  }
  const linePts = ols ? [
    { x: xMin0, y: ols.a + ols.b * xMin0 },
    { x: xMax0, y: ols.a + ols.b * xMax0 },
  ] : [];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="360">
      <rect x={padding.left} y={padding.top} width={plotW} height={plotH} fill="#ffffff" stroke="#E2E8F0" />
      {pts.map((p, i) => (
        <circle key={i} cx={scaleX(p.x)} cy={scaleY(p.y)} r={2} fill="#2D3748" />
      ))}
      {ols && (
        <polyline fill="none" stroke={COLORS[0]} strokeWidth={2} points={linePts.map((p)=>`${scaleX(p.x)},${scaleY(p.y)}`).join(" ")} />
      )}
    </svg>
  );
}

function SimpleCorrelationHeatmap({ data, cols }: { data: any[]; cols: string[] }) {
  const width = 1000; const height = 360;
  const padding = { left: 120, right: 10, top: 40, bottom: 10 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const n = cols.length;
  if (n === 0) return <Text>Select columns</Text> as any;
  // compute correlation matrix
  const vals = cols.map((c) => data.map((r) => toFiniteNumber(r?.[c])).filter((v): v is number => v != null));
  const means = vals.map((a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length));
  const stds = vals.map((a, i) => Math.sqrt(a.reduce((s, v) => s + Math.pow(v - means[i], 2), 0) / Math.max(1, (a.length - 1))))
    .map((s) => (s === 0 ? 1 : s));
  const corr: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { corr[i][j] = 1; continue; }
      let sum = 0; const len = Math.min(vals[i].length, vals[j].length);
      for (let k = 0; k < len; k++) {
        const vi = vals[i][k] - means[i];
        const vj = vals[j][k] - means[j];
        sum += (vi / stds[i]) * (vj / stds[j]);
      }
      corr[i][j] = len > 1 ? sum / (len - 1) : 0;
    }
  }
  const cellSize = Math.min(plotW / n, plotH / n);
  const x0 = padding.left, y0 = padding.top;
  const color = (r: number) => {
    const t = Math.max(-1, Math.min(1, r));
    const pos = t > 0 ? t : 0;
    const neg = t < 0 ? -t : 0;
    const rC = Math.round(255 * neg);
    const bC = Math.round(255 * pos);
    return `rgb(${rC},${Math.round(255*(1-Math.max(pos,neg)))},${bC})`;
  };
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="360">
      <rect x={x0} y={y0} width={cellSize*n} height={cellSize*n} fill="#ffffff" stroke="#E2E8F0" />
      {corr.map((row, i) => row.map((v, j) => (
        <g key={`${i}-${j}`}>
          <rect x={x0 + j*cellSize} y={y0 + i*cellSize} width={cellSize} height={cellSize} fill={color(v)} />
          <text x={x0 + j*cellSize + cellSize/2} y={y0 + i*cellSize + cellSize/2} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#1A202C">
            {Math.round(v*100)/100}
          </text>
        </g>
      )))}
      {/* labels */}
      {cols.map((c, i) => (
        <text key={`yl${i}`} x={padding.left - 6} y={y0 + i*cellSize + cellSize/2} textAnchor="end" dominantBaseline="middle" fontSize="10">{c}</text>
      ))}
      {cols.map((c, j) => (
        <text key={`xl${j}`} x={x0 + j*cellSize + cellSize/2} y={padding.top - 8} textAnchor="middle" dominantBaseline="baseline" fontSize="10" transform={`rotate(-45 ${x0 + j*cellSize + cellSize/2} ${padding.top - 8})`}>{c}</text>
      ))}
    </svg>
  );
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

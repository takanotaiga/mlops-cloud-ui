"use client";

import { Box, Heading, Text, SimpleGrid, VStack, HStack, Badge } from "@chakra-ui/react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSurreal, useSurrealClient } from "@/components/surreal/SurrealProvider";
import { extractRows } from "@/components/surreal/normalize";

type HMRow = {
  id: any;
  ts?: string | number | Date;
  system?: {
    cpu_percent?: number;
    load_average?: number[];
    memory?: {
      available?: number;
      free?: number;
      percent?: number;
      total?: number;
      used?: number;
    }
  };
  gpus?: Array<{
    index?: number;
    name?: string;
    temperature_c?: number;
    fan_speed_percent?: number;
    power_watts?: number;
    utilization?: { gpu_percent?: number; memory_percent?: number };
    clocks_mhz?: { sm?: number; mem?: number };
    pcie?: { rx_kb_s?: number; tx_kb_s?: number };
    memory?: { free?: number; total?: number; used?: number };
  }>;
};

function toMillis(ts: any): number {
  if (ts == null) return NaN;
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    // Handle Surreal temporal strings like d'...' or ISO
    const m = ts.match(/^d'(.*)'$/);
    const iso = m ? m[1] : ts;
    const t = Date.parse(iso);
    return isNaN(t) ? NaN : t;
  }
  if (ts instanceof Date) return ts.getTime();
  try { return Date.parse(String(ts)); } catch { return NaN; }
}

type Series = { name: string; color: string; points: { x: number; y: number }[] };

function LineChart({
  title,
  series,
  unit,
  yMin,
  yMax,
  forceZeroMin,
}: {
  title: string;
  series: Series[];
  unit?: string;
  yMin?: number;
  yMax?: number;
  forceZeroMin?: boolean;
}) {
  const width = 520;
  const height = 160;
  const padding = { l: 40, r: 10, t: 18, b: 22 };
  const innerW = width - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;

  const allPts = series.flatMap((s) => s.points);
  const xs = allPts.map((p) => p.x);
  const ys = allPts.map((p) => p.y).filter((v) => Number.isFinite(v));
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minYData = ys.length ? Math.min(...ys) : 0;
  const maxYData = ys.length ? Math.max(...ys) : 1;
  // Determine y-axis bounds
  let y0 = yMin ?? (forceZeroMin ? 0 : minYData);
  let y1 = yMax ?? maxYData;
  if (y1 === y0) y1 = y0 + 1; // avoid zero height
  if (yMax == null) {
    // apply 10% headroom only when yMax isn't fixed
    const pad = (y1 - y0) * 0.1 || 1;
    y1 = y1 + pad;
    if (!forceZeroMin && yMin == null) {
      y0 = y0 - pad;
    }
    if (forceZeroMin || (yMin != null && yMin === 0)) y0 = 0; // ensure baseline at 0 when requested
  }

  const xScale = (x: number) => {
    const d = maxX === minX ? 1 : (maxX - minX);
    return padding.l + ((x - minX) / d) * innerW;
  };
  const yScale = (y: number) => {
    const d = y1 === y0 ? 1 : (y1 - y0);
    return padding.t + innerH - ((y - y0) / d) * innerH;
  };

  const xTicks = 4;
  const yTicks = 4;

  // Stable, locale-agnostic time formatter (UTC HH:MM:SS) to avoid hydration mismatch
  const fmtTime = (ms: number) => {
    const d = new Date(ms);
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    const s = String(d.getUTCSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  // Helper to format latest numeric values compactly
  const fmtVal = (v: number): string => {
    if (!Number.isFinite(v)) return "—";
    const av = Math.abs(v);
    if (av >= 100) return v.toFixed(0);
    if (av >= 10) return v.toFixed(1);
    return v.toFixed(2);
  };

  // For display of latest values per series
  const latestVals = series.map((s) => {
    for (let i = s.points.length - 1; i >= 0; i--) {
      const y = s.points[i]?.y;
      if (Number.isFinite(y)) return y as number;
    }
    return NaN;
  });

  return (
    <Box bg="white" rounded="md" borderWidth="1px" p={3}>
      <HStack justify="space-between" mb={2} align="center">
        <Heading size="sm">{title}</Heading>
        <HStack gap={3} align="center">
          {series.map((s, i) => (
            <HStack key={i} gap={1} align="center">
              <Box w="8px" h="8px" rounded="sm" bg={s.color} />
              <Text fontSize="xs" color="gray.700">
                {s.name}: {fmtVal(latestVals[i])}{unit ? ` ${unit}` : ""}
              </Text>
            </HStack>
          ))}
          {unit && series.length === 1 && <Badge colorPalette="gray">{unit}</Badge>}
        </HStack>
      </HStack>
      <svg width={width} height={height} role="img" aria-label={title}>
        {/* Axes */}
        <line x1={padding.l} y1={padding.t} x2={padding.l} y2={padding.t + innerH} stroke="#e2e8f0" />
        <line x1={padding.l} y1={padding.t + innerH} x2={padding.l + innerW} y2={padding.t + innerH} stroke="#e2e8f0" />
        {/* Y ticks */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = y0 + (i / yTicks) * (y1 - y0);
          const y = yScale(v);
          return (
            <g key={i}>
              <line x1={padding.l} y1={y} x2={padding.l + innerW} y2={y} stroke="#f1f5f9" />
              <text x={padding.l - 6} y={y} fontSize={10} fill="#64748b" textAnchor="end" dominantBaseline="middle">
                {Number.isFinite(v) ? v.toFixed(0) : ""}
              </text>
            </g>
          );
        })}
        {/* X ticks */}
        {Array.from({ length: xTicks + 1 }).map((_, i) => {
          const t = minX + (i / xTicks) * (maxX - minX);
          const x = xScale(t);
          return (
            <g key={i}>
              <line x1={x} y1={padding.t + innerH} x2={x} y2={padding.t + innerH + 4} stroke="#e2e8f0" />
              <text x={x} y={padding.t + innerH + 14} fontSize={10} fill="#64748b" textAnchor="middle">
                {fmtTime(t)}
              </text>
            </g>
          );
        })}
        {/* Series lines */}
        {series.map((s, si) => {
          const d = s.points
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
            .map((p, idx) => `${idx === 0 ? "M" : "L"}${xScale(p.x)},${yScale(p.y)}`)
            .join(" ");
          return <path key={si} d={d} fill="none" stroke={s.color} strokeWidth={2} />;
        })}
        {/* Legend */}
        <g>
          {series.map((s, i) => (
            <g key={i} transform={`translate(${padding.l + i * 130}, ${padding.t - 6})`}>
              <rect width="10" height="2" fill={s.color} y={6} />
              <text x={14} y={8} fontSize={10} fill="#334155">{s.name}</text>
            </g>
          ))}
        </g>
      </svg>
    </Box>
  );
}

export default function HardwareMetricPage() {
  const surreal = useSurrealClient();
  const { isSuccess } = useSurreal();

  const { data: rows = [] } = useQuery({
    queryKey: ["hardware-metric"],
    enabled: isSuccess,
    queryFn: async () => {
      const res = await surreal.query("SELECT * FROM hardware_metric ORDER BY ts ASC");
      const r = extractRows<HMRow>(res);
      return r;
    },
    refetchInterval: 1000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });

  const points = useMemo(() => {
    const trows = rows.map((r) => ({ ...r, _t: toMillis(r.ts) })).filter((r) => Number.isFinite(r._t));
    // System series
    const sysCpu: Series = { name: "CPU %", color: "#0ea5e9", points: trows.map((r) => ({ x: r._t!, y: r.system?.cpu_percent ?? NaN })) };
    const sysMemPct: Series = { name: "Mem %", color: "#22c55e", points: trows.map((r) => ({ x: r._t!, y: r.system?.memory?.percent ?? NaN })) };
    const sysMemUsed: Series = { name: "Mem Used GiB", color: "#16a34a", points: trows.map((r) => ({ x: r._t!, y: (r.system?.memory?.used ?? NaN) / 1024 / 1024 / 1024 })) };
    const sysMemFree: Series = { name: "Mem Free GiB", color: "#84cc16", points: trows.map((r) => ({ x: r._t!, y: (r.system?.memory?.free ?? NaN) / 1024 / 1024 / 1024 })) };
    const sysLoad1: Series = { name: "Load 1m", color: "#f59e0b", points: trows.map((r) => ({ x: r._t!, y: r.system?.load_average?.[0] ?? NaN })) };
    const sysLoad5: Series = { name: "Load 5m", color: "#ef4444", points: trows.map((r) => ({ x: r._t!, y: r.system?.load_average?.[1] ?? NaN })) };
    const sysLoad15: Series = { name: "Load 15m", color: "#a855f7", points: trows.map((r) => ({ x: r._t!, y: r.system?.load_average?.[2] ?? NaN })) };

    // GPU indexing
    const maxGpuIdx = Math.max(0, ...trows.flatMap((r) => (r.gpus || []).map((g) => g.index ?? 0)));
    const gpuSeries: Record<string, Series[]> = {};
    for (let gi = 0; gi <= maxGpuIdx; gi++) {
      const pick = (mapper: (g: any) => number | undefined, color: string, label: string): Series => ({
        name: `${label} (#${gi})`,
        color,
        points: trows.map((r) => {
          const gpu = (r.gpus || []).find((g) => (g.index ?? 0) === gi);
          const y = gpu ? (mapper(gpu) ?? NaN) : NaN;
          return { x: r._t!, y };
        })
      });
      gpuSeries[`temp_${gi}`] = [pick((g) => g.temperature_c, "#ef4444", `Temp C`)];
      gpuSeries[`power_${gi}`] = [pick((g) => g.power_watts, "#f59e0b", `Power W`)];
      gpuSeries[`fan_${gi}`] = [pick((g) => g.fan_speed_percent, "#22c55e", `Fan %`)];
      gpuSeries[`util_${gi}`] = [
        pick((g) => g.utilization?.gpu_percent, "#0ea5e9", `GPU %`),
        pick((g) => g.utilization?.memory_percent, "#a855f7", `VRAM %`),
      ];
      gpuSeries[`clock_${gi}`] = [
        pick((g) => g.clocks_mhz?.sm, "#10b981", `SM MHz`),
        pick((g) => g.clocks_mhz?.mem, "#6366f1", `Mem MHz`),
      ];
      gpuSeries[`pcie_${gi}`] = [
        pick((g) => (g.pcie?.rx_kb_s ?? NaN) / 1_000_000, "#06b6d4", `PCIe RX GB/s`),
        pick((g) => (g.pcie?.tx_kb_s ?? NaN) / 1_000_000, "#059669", `PCIe TX GB/s`),
      ];
      gpuSeries[`vram_${gi}`] = [
        pick((g) => (g.memory?.used ?? NaN) / 1024 / 1024 / 1024, "#c026d3", `VRAM Used GiB`),
        pick((g) => (g.memory?.free ?? NaN) / 1024 / 1024 / 1024, "#9333ea", `VRAM Free GiB`),
      ];
    }

    return {
      sys: { sysCpu, sysMemPct, sysMemUsed, sysMemFree, sysLoad1, sysLoad5, sysLoad15 },
      gpuSeries,
    };
  }, [rows]);

  const gpuNames = useMemo(() => {
    const map = new Map<number, string>();
    // Prefer the latest seen name per index
    for (const r of rows) {
      for (const g of r.gpus || []) {
        const idx = g.index ?? 0;
        if (g.name) map.set(idx, String(g.name));
      }
    }
    return map;
  }, [rows]);

  const distinctGpuIdx = useMemo(() => {
    const s = new Set<number>();
    rows.forEach((r) => (r.gpus || []).forEach((g) => s.add(g.index ?? 0)));
    return Array.from(s.values()).sort((a, b) => a - b);
  }, [rows]);

  return (
    <Box px={{ base: "12px", md: "5%" }} py={6}>
      <Heading size="lg" mb={2}>Hardware Metrics</Heading>
      <Text color="gray.600" mb={4}>Time series over the last ~10 minutes. Auto-refreshing.</Text>

      <VStack align="stretch" gap={4}>
        <Heading size="md">System</Heading>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
          <LineChart title="CPU Utilization" series={[points.sys.sysCpu]} unit="%" yMin={0} yMax={100} />
          <LineChart title="Memory Percent" series={[points.sys.sysMemPct]} unit="%" yMin={0} yMax={100} />
          <LineChart title="Memory (GiB)" series={[points.sys.sysMemUsed, points.sys.sysMemFree]} unit="GiB" forceZeroMin />
          <LineChart title="Load Average" series={[points.sys.sysLoad1, points.sys.sysLoad5, points.sys.sysLoad15]} forceZeroMin />
        </SimpleGrid>

        <Box borderTopWidth="1px" my={2} />
        <Heading size="md">GPUs</Heading>
        {distinctGpuIdx.length === 0 && (
          <Text color="gray.600">No GPU metrics.</Text>
        )}
        {distinctGpuIdx.map((gi) => (
          <VStack key={gi} align="stretch" gap={3}>
            <HStack>
              <Heading size="sm">{(() => {
                const full = gpuNames.get(gi) || `GPU #${gi}`;
                const short = full
                  .replace(/^NVIDIA\s+GeForce\s+/i, "")
                  .replace(/^NVIDIA\s+/i, "")
                  .trim();
                return short || full;
              })()}</Heading>
              <Badge colorPalette="purple">Index {gi}</Badge>
            </HStack>
            <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
              <LineChart title={`Temperature (C)`} series={points.gpuSeries[`temp_${gi}`]} unit="C" forceZeroMin />
              <LineChart title={`Power (W)`} series={points.gpuSeries[`power_${gi}`]} unit="W" forceZeroMin />
              <LineChart title={`Fan (%)`} series={points.gpuSeries[`fan_${gi}`]} unit="%" yMin={0} yMax={100} />
              <LineChart title={`Utilization (%)`} series={points.gpuSeries[`util_${gi}`]} unit="%" yMin={0} yMax={100} />
              <LineChart title={`Clocks (MHz)`} series={points.gpuSeries[`clock_${gi}`]} unit="MHz" forceZeroMin />
              <LineChart title={`PCIe (GB/s)`} series={points.gpuSeries[`pcie_${gi}`]} unit="GB/s" forceZeroMin />
              <LineChart title={`VRAM (GiB)`} series={points.gpuSeries[`vram_${gi}`]} unit="GiB" forceZeroMin />
            </SimpleGrid>
          </VStack>
        ))}
      </VStack>
    </Box>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import { Status, Text, Tooltip, Box } from "@chakra-ui/react";

type MinioState = { ok: boolean; loading: boolean; message?: string }

export default function ConnectionStatus() {
  const [dbOk, setDbOk] = useState(false);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbErr, setDbErr] = useState<string | null>(null);
  const [minio, setMinio] = useState<MinioState>({ ok: false, loading: true });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      setDbLoading(true);
      setMinio({ ok: false, loading: true });
      try {
        const res = await fetch("/api/status");
        const j = await res.json();
        if (!cancelled) {
          setDbOk(!!j.dbOk);
          setDbErr(j.dbOk ? null : (j.dbError ? String(j.dbError) : "error"));
          setDbLoading(false);
          setMinio({ ok: !!j.s3Ok, loading: false, message: j.s3Ok ? undefined : (j.s3Error ? String(j.s3Error) : "error") });
        }
      } catch (e: any) {
        if (!cancelled) {
          setDbOk(false);
          setDbErr(String(e?.message || e));
          setDbLoading(false);
          setMinio({ ok: false, loading: false, message: "status error" });
        }
      }
    };
    void check();
    return () => { cancelled = true; };
  }, []);

  const allOk = dbOk && minio.ok;
  const anyLoading = dbLoading || minio.loading;
  const color = allOk ? "green" : anyLoading ? "orange" : "red";

  let label = "" as string;
  let detail = "" as string;
  if (anyLoading) {
    label = "Checking";
    detail = "";
  } else if (allOk) {
    label = "Connected";
  } else {
    const dbMsg = dbErr ? `DB: ${String(dbErr ?? "error")}` : "";
    const s3Msg = !minio.ok ? `MinIO: ${minio.message ?? "error"}` : "";
    detail = [dbMsg, s3Msg].filter(Boolean).join(" | ");
    // Header should only show compact labels, details go to tooltip
    const labelParts: string[] = [];
    if (dbErr) labelParts.push("DB: Error");
    if (!minio.ok) labelParts.push("S3: Error");
    label = labelParts.join(", ") || "Error";
  }

  const content = (
    <Box display="inline-flex" alignItems="center" h="25px" >
      <Status.Root colorPalette={color} display="inline-flex" alignItems="center" gap="1" lineHeight="1">
        <Status.Indicator />
        <Text textStyle="sm" lineHeight="1">{label}</Text>
      </Status.Root>
    </Box>
  );

  if (!detail) return content;
  return (
    <Tooltip.Root openDelay={150} closeDelay={50} >
      <Tooltip.Trigger>
        <Box display="inline-flex" alignItems="center" h="25px">{content}</Box>
      </Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Content>
          <Text fontSize="xs">{detail}</Text>
        </Tooltip.Content>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Status, Text, Tooltip, Box } from "@chakra-ui/react"
import { useSurreal } from "@/components/surreal/SurrealProvider"
import { S3Client } from "@aws-sdk/client-s3"
import { MINIO_CONFIG } from "@/app/secrets/minio-config"
import { ensureBucketExists } from "@/components/minio/ensure-bucket"

type MinioState = { ok: boolean; loading: boolean; message?: string }

export default function ConnectionStatus() {
  const { isSuccess: dbOk, isError: dbErr, isConnecting: dbLoading, error: dbError } = useSurreal()
  const [minio, setMinio] = useState<MinioState>({ ok: false, loading: true })

  const s3 = useMemo(() => {
    return new S3Client({
      region: MINIO_CONFIG.region,
      endpoint: MINIO_CONFIG.endpoint,
      forcePathStyle: MINIO_CONFIG.forcePathStyle,
      credentials: {
        accessKeyId: MINIO_CONFIG.accessKeyId,
        secretAccessKey: MINIO_CONFIG.secretAccessKey,
      },
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      setMinio((s) => ({ ...s, loading: true }))
      try {
        await ensureBucketExists(s3, MINIO_CONFIG.bucket, MINIO_CONFIG.region)
        if (!cancelled) setMinio({ ok: true, loading: false })
      } catch (e: any) {
        const msg = e?.name || e?.code || e?.message || "MinIO error"
        if (!cancelled) setMinio({ ok: false, loading: false, message: String(msg) })
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [s3])

  const allOk = dbOk && minio.ok
  const anyLoading = dbLoading || minio.loading
  const color = allOk ? "green" : anyLoading ? "orange" : "red"

  let label = "" as string
  let detail = "" as string
  if (anyLoading) {
    label = "Checking"
    detail = ""
  } else if (allOk) {
    label = "Connected"
  } else {
    const dbMsg = dbErr ? `DB: ${String(dbError ?? "error")}` : ""
    const s3Msg = !minio.ok ? `MinIO: ${minio.message ?? "error"}` : ""
    detail = [dbMsg, s3Msg].filter(Boolean).join(" | ")
    // Header should only show compact labels, details go to tooltip
    const labelParts: string[] = []
    if (dbErr) labelParts.push("DB: Error")
    if (!minio.ok) labelParts.push("S3: Error")
    label = labelParts.join(", ") || "Error"
  }

  const content = (
    <Box display="inline-flex" alignItems="center" h="25px" >
      <Status.Root colorPalette={color} display="inline-flex" alignItems="center" gap="1" lineHeight="1">
        <Status.Indicator />
        <Text textStyle="sm" lineHeight="1">{label}</Text>
      </Status.Root>
    </Box>
  )

  if (!detail) return content
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
  )
}

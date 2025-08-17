import { NextResponse } from "next/server";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getS3Client, getBucketName, getS3Region, ensureBucketExistsServer } from "@/lib/server/s3";
import { withSurreal } from "@/lib/server/surreal";

export const runtime = "nodejs";

export async function GET() {
  let dbOk = false;
  let dbError: string | undefined;
  try {
    await withSurreal(async (c) => {
      // Lightweight ping: a no-op select that should be fast
      await c.query("RETURN true");
    });
    dbOk = true;
  } catch (e: any) {
    dbOk = false;
    dbError = e?.message || String(e);
  }

  let s3Ok = false;
  let s3Error: string | undefined;
  try {
    const s3 = getS3Client();
    const Bucket = getBucketName();
    const Region = getS3Region();
    // Ensure bucket exists; safe if already exists
    await ensureBucketExistsServer(s3, Bucket, Region);
    // Final verification (optional)
    await s3.send(new HeadBucketCommand({ Bucket }));
    s3Ok = true;
  } catch (e: any) {
    s3Ok = false;
    s3Error = e?.name || e?.code || e?.message || String(e);
  }

  return NextResponse.json({ dbOk, s3Ok, dbError, s3Error });
}

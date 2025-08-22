import { NextRequest, NextResponse } from "next/server";
import { getS3Client } from "@/lib/server/s3";
import { GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

export const runtime = "nodejs";

function getParams(req: NextRequest) {
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") || url.searchParams.get("b");
  const key = url.searchParams.get("key") || url.searchParams.get("k");
  if (!bucket || !key) throw new Error("Missing bucket or key");
  return { bucket, key } as const;
}

export async function GET(req: NextRequest) {
  try {
    const { bucket, key } = getParams(req);
    const s3 = getS3Client();
    const range = req.headers.get("range") || undefined;
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range } as any));
    const body = out.Body as any;
    const nodeStream: any = (body?.pipe ? body : Readable.from(body)) as Readable;
    const webStream = (Readable as any).toWeb ? (Readable as any).toWeb(nodeStream) : (nodeStream as any);
    const headers: Record<string, string> = {};
    headers["Accept-Ranges"] = "bytes";
    if (out.ContentType) headers["Content-Type"] = out.ContentType;
    if (out.ContentLength != null) headers["Content-Length"] = String(out.ContentLength);
    if ((out as any).ContentRange) headers["Content-Range"] = String((out as any).ContentRange);
    if (out.ETag) headers["ETag"] = out.ETag;
    if (out.LastModified) headers["Last-Modified"] = new Date(out.LastModified).toUTCString();
    const status = range ? 206 : 200;
    return new Response(webStream as any, { headers, status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function HEAD(req: NextRequest) {
  try {
    const { bucket, key } = getParams(req);
    const s3 = getS3Client();
    const out = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const headers: Record<string, string> = {};
    if (out.ContentType) headers["Content-Type"] = out.ContentType;
    if (out.ContentLength != null) headers["Content-Length"] = String(out.ContentLength);
    if (out.ETag) headers["ETag"] = out.ETag;
    if (out.LastModified) headers["Last-Modified"] = new Date(out.LastModified).toUTCString();
    return new Response(null, { headers });
  } catch (e: any) {
    return new Response(null, { status: 404 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { bucket, key } = getParams(req);
    const s3 = getS3Client();
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

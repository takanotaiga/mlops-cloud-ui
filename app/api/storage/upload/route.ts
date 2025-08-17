import { NextResponse } from "next/server";
import { getS3Client, getBucketName, getS3Region, ensureBucketExistsServer } from "@/lib/server/s3";
import { Upload } from "@aws-sdk/lib-storage";
import { PutObjectCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

// POST form-data: file, dataset, filename, contentType(optional)
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const dataset = (form.get("dataset") || "").toString().trim();
  const filename = (form.get("filename") || "").toString().trim();
  const contentType = (form.get("contentType") || "").toString() || undefined;
  const isThumb = (form.get("isThumb") || "").toString() === "true";

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!dataset || !filename) {
    return NextResponse.json({ error: "Missing dataset or filename" }, { status: 400 });
  }

  // sanitize minimal: remove leading slashes, collapse ..
  const safeDataset = dataset.replace(/^\/+/, "").replace(/\.\.+/g, ".");
  const safeFilename = filename.replace(/^\/+/, "").replace(/\\/g, "/").replace(/\.\.+/g, ".");
  const Key = isThumb ? `${safeDataset}/.thumbs/${safeFilename}` : `${safeDataset}/${safeFilename}`;

  try {
    const s3 = getS3Client();
    const Bucket = getBucketName();
    const Region = getS3Region();
    // Ensure bucket exists (dev-friendly; safe if already exists)
    try { await ensureBucketExistsServer(s3, Bucket, Region); } catch { /* ignore bucket creation errors */ }
    // Prefer passing Blob directly to AWS SDK (Node 18 supports Blob type)
    const body: any = file as Blob;

    // Large file support via managed upload
    const threshold = Number(process.env.S3_MULTIPART_THRESHOLD_BYTES || 1_000_000_000);
    if (file.size > threshold) {
      const uploader = new Upload({
        client: s3,
        params: { Bucket, Key, Body: body, ContentType: contentType },
        queueSize: 3,
        partSize: 100 * 1024 * 1024,
        leavePartsOnError: false,
      });
      await uploader.done();
    } else {
      // For small uploads, send a Buffer to avoid streaming/hash issues in some runtimes
      const buf = Buffer.from(await file.arrayBuffer());
      await s3.send(new PutObjectCommand({ Bucket, Key, Body: buf, ContentType: contentType, ContentLength: buf.byteLength } as any));
    }

    return NextResponse.json({ bucket: Bucket, key: Key });
  } catch (e: any) {
    const msg = e?.message || e?.toString?.() || String(e);
    const code = e?.name || e?.Code || e?.code;
    return NextResponse.json({ error: msg, code }, { status: 500 });
  }
}

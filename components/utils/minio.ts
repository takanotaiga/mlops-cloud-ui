import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { MINIO_CONFIG } from "@/app/secrets/minio-config";

function createS3Client() {
  return new S3Client({
    region: MINIO_CONFIG.region,
    endpoint: MINIO_CONFIG.endpoint,
    forcePathStyle: MINIO_CONFIG.forcePathStyle,
    credentials: {
      accessKeyId: MINIO_CONFIG.accessKeyId,
      secretAccessKey: MINIO_CONFIG.secretAccessKey,
    },
  });
}

function joinPath(...parts: string[]) {
  return parts
    .map((p) =>
      p
        .split("/")
        .filter(Boolean)
        .map((seg) => encodeURIComponent(seg))
        .join("/")
    )
    .join("/");
}

export async function getSignedObjectUrl(
  bucket: string,
  key: string,
  expiresInSeconds: number = 60 * 5,
): Promise<string> {
  try {
    // Dynamic import to avoid hard dependency if package isn't installed yet
    const importer = new Function("m", "return import(m)") as (m: string) => Promise<any>;
    const mod: any = await importer("@aws-sdk/s3-request-presigner");
    const getSignedUrl: any = mod.getSignedUrl;
    if (!getSignedUrl) throw new Error("presigner missing");
    const s3 = createS3Client();
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const url = await getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
    return url as string;
  } catch {
    // Fallback: fetch object and return a blob URL (requires credentials and CORS)
    try {
      const s3 = createS3Client();
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const blob = await new Response(out.Body as any).blob();
      const blobUrl = URL.createObjectURL(blob);
      return blobUrl;
    } catch {
      // Last resort: construct a direct path-style URL (may fail if bucket is private)
      const base = MINIO_CONFIG.endpoint.replace(/\/$/, "");
      const objectPath = joinPath(bucket, key);
      return `${base}/${objectPath}`;
    }
  }
}

export async function getObjectUrlPreferPresign(
  bucket: string,
  key: string,
  expiresInSeconds: number = 60 * 5,
): Promise<{ url: string; isBlob: boolean; sizeBytes?: number }> {
  try {
    const importer = new Function("m", "return import(m)") as (m: string) => Promise<any>;
    const mod: any = await importer("@aws-sdk/s3-request-presigner");
    const getSignedUrl: any = mod.getSignedUrl;
    if (getSignedUrl) {
      const s3 = createS3Client();
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      const url = await getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
      return { url, isBlob: false };
    }
    throw new Error("presigner missing");
  } catch (e) {
    try {
      const s3 = createS3Client();
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const blob = await new Response(out.Body as any).blob();
      const url = URL.createObjectURL(blob);
      return { url, isBlob: true, sizeBytes: blob.size };
    } catch {
      // Last resort: construct a direct path-style URL (may fail if bucket is private)
      const base = MINIO_CONFIG.endpoint.replace(/\/$/, "");
      const objectPath = [bucket, key]
        .map((p) => p.split("/").filter(Boolean).map((seg) => encodeURIComponent(seg)).join("/"))
        .join("/");
      const url = `${base}/${objectPath}`;
      return { url, isBlob: false };
    }
  }
}

export async function deleteObjectFromS3(bucket: string, key: string): Promise<void> {
  const s3 = createS3Client();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

import { S3Client, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";

export function getS3Client() {
  const endpoint = process.env.MINIO_ENDPOINT_INTERNAL || process.env.MINIO_ENDPOINT || "http://taiga-macmini.local:65300";
  const region = getS3Region();
  const accessKeyId = process.env.MINIO_ACCESS_KEY_ID || "minioadmin";
  const secretAccessKey = process.env.MINIO_SECRET_ACCESS_KEY || "minioadmin";
  const forcePathStyle = (process.env.MINIO_FORCE_PATH_STYLE || "true").toLowerCase() !== "false";

  return new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export function getBucketName() {
  return process.env.MINIO_BUCKET || "mlops-datasets";
}

export function getS3Region() {
  return process.env.MINIO_REGION || "us-east-1";
}

export async function ensureBucketExistsServer(s3: S3Client, bucket: string, region?: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (_e) {
    try {
      const params: any = { Bucket: bucket };
      if (region && region !== "us-east-1") params.CreateBucketConfiguration = { LocationConstraint: region };
      await s3.send(new CreateBucketCommand(params));
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (e: any) {
      const code = e?.name || e?.Code || e?.code || "";
      if (code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists") return;
      throw e;
    }
  }
}

// NOTE: This file intentionally contains only configuration values
// as requested. Replace the placeholders with your actual MinIO details.

export const MINIO_CONFIG = {
  endpoint: "http://taiga-macmini.local:65300", // e.g. http://127.0.0.1:9000
  region: "us-east-1",               // MinIO commonly uses us-east-1
  accessKeyId: "minioadmin",    // replace with your access key
  secretAccessKey: "minioadmin", // replace with your secret
  bucket: "mlops-datasets",             // target bucket name (lowercase, DNS-safe)
  // Force path-style for MinIO (http://endpoint/bucket/key)
  forcePathStyle: true as const,
}

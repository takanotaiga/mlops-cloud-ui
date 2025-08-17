// Client-side utilities now call our API routes instead of using AWS SDK.

export async function getSignedObjectUrl(
  bucket: string,
  key: string,
  _expiresInSeconds: number = 60 * 5,
): Promise<string> {
  // Return a proxied URL that streams from the server (works with internal-only S3 endpoints)
  return `/api/storage/object?b=${encodeURIComponent(bucket)}&k=${encodeURIComponent(key)}`;
}

export async function getObjectUrlPreferPresign(
  bucket: string,
  key: string,
  _expiresInSeconds: number = 60 * 5,
): Promise<{ url: string; isBlob: boolean; sizeBytes?: number }> {
  const url = `/api/storage/object?b=${encodeURIComponent(bucket)}&k=${encodeURIComponent(key)}`;
  // Optionally, we could HEAD here to get size; skip for minimal change.
  return { url, isBlob: false };
}

export async function deleteObjectFromS3(bucket: string, key: string): Promise<void> {
  const url = `/api/storage/object?b=${encodeURIComponent(bucket)}&k=${encodeURIComponent(key)}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}

// Unified browser-side cache for large objects (videos/parquet)
// - Uses OPFS when available (navigator.storage.getDirectory)
// - Falls back to Cache Storage API otherwise

const CACHE_NAME = "mlops-cache-v1";
const INDEX_KEY = "mlops-cache-index-v1";

type CacheIndex = Record<string, number>; // map of cacheKey -> sizeBytes

function makeIndexKey(bucket: string, key: string): string {
  return `${bucket}:::${key}`;
}

function readIndex(): CacheIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? (obj as CacheIndex) : {};
  } catch { return {}; }
}

function writeIndex(idx: CacheIndex) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch { /* ignore */ }
}

function updateIndex(bucket: string, key: string, sizeBytes: number) {
  try {
    const idx = readIndex();
    idx[makeIndexKey(bucket, key)] = Math.max(0, Math.floor(sizeBytes || 0));
    writeIndex(idx);
  } catch { /* ignore */ }
}

function removeFromIndex(bucket: string, key: string) {
  try {
    const idx = readIndex();
    delete idx[makeIndexKey(bucket, key)];
    writeIndex(idx);
  } catch { /* ignore */ }
}

function clearIndex() {
  try { localStorage.removeItem(INDEX_KEY); } catch { /* ignore */ }
}

function opfsAvailable(): boolean {
  // Some browsers (e.g. Safari) do not support OPFS
  try { return typeof (navigator as any)?.storage?.getDirectory === "function"; } catch { return false; }
}

async function getOpfsRoot(): Promise<any> {
  const ns: any = (navigator as any).storage;
  return await ns.getDirectory();
}

async function ensurePath(root: any, path: string, create: boolean): Promise<{ dir: any; name: string }> {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop() || "";
  let dir = root;
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p, { create });
  }
  return { dir, name };
}

function makeObjectUrl(bucket: string, key: string): string {
  return `/api/storage/object?b=${encodeURIComponent(bucket)}&k=${encodeURIComponent(key)}`;
}

export async function cacheExists(bucket: string, key: string): Promise<boolean> {
  if (opfsAvailable()) {
    try {
      const root = await getOpfsRoot();
      const { dir, name } = await ensurePath(root, key, false);
      await dir.getFileHandle(name, { create: false });
      return true;
    } catch { return false; }
  }
  if (!("caches" in self)) return false;
  const c = await caches.open(CACHE_NAME);
  const res = await c.match(makeObjectUrl(bucket, key));
  return !!res;
}

export async function getCachedBlobUrl(bucket: string, key: string): Promise<string | null> {
  if (opfsAvailable()) {
    try {
      const root = await getOpfsRoot();
      const { dir, name } = await ensurePath(root, key, false);
      const fh = await dir.getFileHandle(name, { create: false });
      const file = await fh.getFile();
      return URL.createObjectURL(file);
    } catch { return null; }
  }
  if (!("caches" in self)) return null;
  const c = await caches.open(CACHE_NAME);
  const res = await c.match(makeObjectUrl(bucket, key));
  if (!res) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function readCachedBytes(bucket: string, key: string): Promise<Uint8Array | null> {
  if (opfsAvailable()) {
    try {
      const root = await getOpfsRoot();
      const { dir, name } = await ensurePath(root, key, false);
      const fh = await dir.getFileHandle(name, { create: false });
      const file = await fh.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch { return null; }
  }
  if (!("caches" in self)) return null;
  const c = await caches.open(CACHE_NAME);
  const res = await c.match(makeObjectUrl(bucket, key));
  if (!res) return null;
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function downloadAndCacheWithProgress(bucket: string, key: string, expectedSize?: number, onProgress?: (pct: number) => void): Promise<string> {
  const url = makeObjectUrl(bucket, key);
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
  const total = expectedSize && expectedSize > 0 ? expectedSize : Number(resp.headers.get("Content-Length") || 0);
  const reader = resp.body.getReader();

  if (opfsAvailable()) {
    const root = await getOpfsRoot();
    const { dir, name } = await ensurePath(root, key, true);
    const fh = await dir.getFileHandle(name, { create: true });
    const writable = await (fh as any).createWritable();
    let downloaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await writable.write(value);
        downloaded += value.length || value.byteLength || 0;
        if (total > 0 && onProgress) onProgress(Math.min(100, Math.round((downloaded / total) * 100)));
      }
    }
    await writable.close();
    const blobUrl = await getCachedBlobUrl(bucket, key);
    if (!blobUrl) throw new Error("cache write failed");
    try {
      // get size from written file
      const ns: any = (navigator as any).storage;
      const root = await ns.getDirectory();
      const { dir, name } = await ensurePath(root, key, false);
      const fh = await dir.getFileHandle(name, { create: false });
      const f = await fh.getFile();
      updateIndex(bucket, key, f.size || 0);
    } catch { /* ignore */ }
    if (onProgress && total > 0) onProgress(100);
    return blobUrl;
  }

  // Cache Storage fallback: accumulate chunks then put into cache
  const chunks: Uint8Array[] = [];
  let downloaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      downloaded += value.length || value.byteLength || 0;
      if (total > 0 && onProgress) onProgress(Math.min(100, Math.round((downloaded / total) * 100)));
    }
  }
  // Merge chunks into a fresh ArrayBuffer to avoid SharedArrayBuffer-backed views
  const totalBytes = chunks.reduce((acc, cur) => acc + cur.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const blob = new Blob([merged.buffer]);
  if ("caches" in self) {
    const c = await caches.open(CACHE_NAME);
    await c.put(url, new Response(blob, { headers: { "Content-Type": resp.headers.get("Content-Type") || "application/octet-stream" } }));
  }
  try { updateIndex(bucket, key, blob.size || 0); } catch { /* ignore */ }
  if (onProgress && total > 0) onProgress(100);
  return URL.createObjectURL(blob);
}

export async function downloadAndCacheBytes(bucket: string, key: string): Promise<Uint8Array> {
  const url = makeObjectUrl(bucket, key);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (opfsAvailable()) {
    try {
      const root = await getOpfsRoot();
      const { dir, name } = await ensurePath(root, key, true);
      const fh = await dir.getFileHandle(name, { create: true });
      const writable = await (fh as any).createWritable();
      await writable.write(bytes);
      await writable.close();
      try {
        const f = await (await (await dir.getFileHandle(name, { create: false })).getFile());
        updateIndex(bucket, key, f.size || bytes.length);
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  } else if ("caches" in self) {
    try {
      const c = await caches.open(CACHE_NAME);
      await c.put(url, new Response(bytes));
      updateIndex(bucket, key, bytes.length);
    } catch { /* ignore */ }
  }
  return bytes;
}

export async function deleteCached(bucket: string, key: string): Promise<void> {
  if (opfsAvailable()) {
    try {
      const root = await getOpfsRoot();
      const { dir, name } = await ensurePath(root, key, false);
      await dir.removeEntry(name, { recursive: false } as any);
    } catch { /* ignore */ }
  }
  if ("caches" in self) {
    try {
      const c = await caches.open(CACHE_NAME);
      await c.delete(makeObjectUrl(bucket, key));
    } catch { /* ignore */ }
  }
  removeFromIndex(bucket, key);
}

export async function clearAllCached(): Promise<void> {
  if (opfsAvailable()) {
    try {
      const root = await getOpfsRoot();
      // Collect names first to avoid iterator invalidation
      const names: string[] = [];
      for await (const [name] of (root as any).entries()) names.push(name);
      for (const name of names) {
        try { await root.removeEntry(name, { recursive: true }); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  if ("caches" in self) {
    try { await caches.delete(CACHE_NAME); } catch { /* ignore */ }
  }
  clearIndex();
}

export async function getTotalCachedBytes(): Promise<number> {
  // Prefer index if available (fast and accurate across both backends)
  const idx = readIndex();
  const keys = Object.keys(idx);
  if (keys.length > 0) {
    return keys.reduce((s, k) => s + Math.max(0, Number(idx[k] || 0)), 0);
  }

  let total = 0;
  if (opfsAvailable()) {
    try {
      const root = await getOpfsRoot();
      for await (const [, handle] of (root as any).entries()) {
        try {
          if (handle.kind === "file") {
            const f = await handle.getFile();
            total += f.size || 0;
          } else if (handle.kind === "directory") {
            total += await dirSize(handle);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  if ("caches" in self) {
    try {
      const c = await caches.open(CACHE_NAME);
      const keys = await c.keys();
      for (const req of keys) {
        try {
          const res = await c.match(req);
          if (!res) continue;
          const len = Number(res.headers.get("Content-Length") || 0);
          if (len > 0) { total += len; continue; }
          const blob = await res.clone().blob();
          total += blob.size || 0;
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  return total;
}

async function dirSize(dir: any): Promise<number> {
  let sum = 0;
  for await (const [, handle] of (dir as any).entries()) {
    try {
      if (handle.kind === "file") {
        const f = await handle.getFile();
        sum += f.size || 0;
      } else if (handle.kind === "directory") {
        sum += await dirSize(handle);
      }
    } catch { /* ignore */ }
  }
  return sum;
}

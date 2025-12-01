// Browser-side cache helpers for large downloads (videos/parquet).
// Prefers OPFS when available, falls back to Cache Storage.

const CACHE_NAME = "mlops-cache-v1";
const INDEX_KEY = "mlops-cache-index-v1";

type CacheIndex = Record<string, number>;

function makeIndexKey(bucket: string, key: string): string {
  return `${bucket}:::${key}`;
}

function readIndex(): CacheIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? (obj as CacheIndex) : {};
  } catch {
    return {};
  }
}

function writeIndex(idx: CacheIndex) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  } catch {
    /* ignore */
  }
}

function updateIndex(bucket: string, key: string, sizeBytes: number) {
  try {
    const idx = readIndex();
    idx[makeIndexKey(bucket, key)] = Math.max(0, Math.floor(sizeBytes || 0));
    writeIndex(idx);
  } catch {
    /* ignore */
  }
}

function opfsAvailable(): boolean {
  try {
    return typeof (navigator as any)?.storage?.getDirectory === "function";
  } catch {
    return false;
  }
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
    } catch {
      return false;
    }
  }
  if (!("caches" in self)) return false;
  const c = await caches.open(CACHE_NAME);
  const res = await c.match(makeObjectUrl(bucket, key));
  return !!res;
}

export async function readCachedBytes(bucket: string, key: string): Promise<Uint8Array | null> {
  if (opfsAvailable()) {
    try {
      const root = await getOpfsRoot();
      const { dir, name } = await ensurePath(root, key, false);
      const fh = await dir.getFileHandle(name, { create: false });
      const file = await fh.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  }
  if (!("caches" in self)) return null;
  const c = await caches.open(CACHE_NAME);
  const res = await c.match(makeObjectUrl(bucket, key));
  if (!res) return null;
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
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
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  } else if ("caches" in self) {
    try {
      const c = await caches.open(CACHE_NAME);
      await c.put(url, new Response(bytes));
      updateIndex(bucket, key, bytes.length);
    } catch {
      /* ignore */
    }
  }

  return bytes;
}

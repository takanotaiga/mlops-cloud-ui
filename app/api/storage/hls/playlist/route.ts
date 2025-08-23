import { NextRequest, NextResponse } from "next/server";
import { getS3Client } from "@/lib/server/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

function params(req: NextRequest) {
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") || url.searchParams.get("b");
  const key = url.searchParams.get("key") || url.searchParams.get("k");
  if (!bucket || !key) throw new Error("Missing bucket or key");
  return { bucket, key } as const;
}

function isAbsoluteUrl(line: string): boolean {
  return /^(https?:)?\/\//i.test(line);
}

function dirnameOfKey(key: string): string {
  const idx = key.lastIndexOf("/");
  if (idx <= 0) return "";
  return key.slice(0, idx + 1);
}

export async function GET(req: NextRequest) {
  try {
    const { bucket, key } = params(req);
    const s3 = getS3Client();
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await (out.Body as any).transformToString?.() ?? (await new Response(out.Body as any).text());

    const baseDir = dirnameOfKey(key);
    const proxyBase = `/api/storage/object?b=${encodeURIComponent(bucket)}&k=`;

    const rewriteDirectiveUri = (line: string, tag: string) => {
      // Rewrite URI="..." inside directives like EXT-X-MAP or EXT-X-KEY when relative
      const re = new RegExp(`^(#${tag}:[^\\r\\n]*?URI=)("([^"]+)"|'([^']+)')`);
      const m = line.match(re);
      if (!m) return line;
      const prefix = m[1];
      // const quoted = m[2]; // not needed after normalizing to double-quotes
      const val = m[3] || m[4] || "";
      if (!val || isAbsoluteUrl(val)) return line;
      const joined = baseDir ? baseDir + val : val;
      const newUri = proxyBase + encodeURIComponent(joined);
      const quote = "\"";
      return line.replace(re, `${prefix}${quote}${newUri}${quote}`);
    };

    const rewritten = text
      .split(/\r?\n/)
      .map((line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith("#EXT-X-MAP:")) return rewriteDirectiveUri(line, "EXT-X-MAP");
        if (trimmed.startsWith("#EXT-X-KEY:")) return rewriteDirectiveUri(line, "EXT-X-KEY");
        if (trimmed.startsWith("#")) return line; // other directives
        if (isAbsoluteUrl(trimmed)) return line; // already absolute
        // Media segment line
        const joined = baseDir ? baseDir + trimmed : trimmed;
        return proxyBase + encodeURIComponent(joined);
      })
      .join("\n");

    const headers = new Headers();
    headers.set("Content-Type", "application/vnd.apple.mpegurl");
    // let clients cache briefly
    headers.set("Cache-Control", "private, max-age=30");
    return new NextResponse(rewritten, { headers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

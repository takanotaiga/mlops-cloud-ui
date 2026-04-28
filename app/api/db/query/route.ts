import { NextResponse } from "next/server";
import { DbOperationError, executeDbOperation } from "@/lib/server/db/operations";

export const runtime = "nodejs";

type Body = {
  operation?: string;
  vars?: Record<string, unknown>;
  sql?: unknown;
};

export async function POST(req: Request) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: "DB query API requires same-origin access" }, { status: 401 });
  }

  try {
    const body = await readBody(req);
    if (body?.sql !== undefined) {
      return NextResponse.json({ error: "Raw SQL is not accepted by this API" }, { status: 403 });
    }

    const operation = typeof body?.operation === "string" ? body.operation : "";
    if (!operation) {
      return NextResponse.json({ error: "Missing operation" }, { status: 400 });
    }

    const result = await executeDbOperation(operation, body?.vars ?? {});
    return NextResponse.json(result);
  } catch (e: unknown) {
    if (e instanceof DbOperationError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

async function readBody(req: Request): Promise<Body> {
  try {
    return (await req.json()) as Body;
  } catch {
    throw new DbOperationError("Invalid JSON body", 400);
  }
}

function isAuthorizedRequest(req: Request): boolean {
  const token = process.env.DB_QUERY_API_TOKEN;
  const auth = req.headers.get("authorization") || "";
  if (token && auth === `Bearer ${token}`) return true;

  const requestUrl = new URL(req.url);
  const host = req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const hostOrigin = host ? `${forwardedProto || requestUrl.protocol.replace(":", "")}://${host}` : undefined;
  const allowedOrigins = new Set([
    requestUrl.origin,
    hostOrigin,
    process.env.APP_ORIGIN,
    process.env.NEXT_PUBLIC_APP_ORIGIN,
    process.env.BASE_URL,
  ].filter((value): value is string => Boolean(value)));

  const origin = req.headers.get("origin");
  if (origin) return allowedOrigins.has(origin);

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin") return true;

  const referer = req.headers.get("referer");
  if (!referer) return false;

  try {
    return allowedOrigins.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

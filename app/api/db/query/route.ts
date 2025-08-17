import { NextResponse } from "next/server";
import { withSurreal } from "@/lib/server/surreal";

export const runtime = "nodejs";

type Body = { sql?: string; vars?: Record<string, unknown> };

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const sql = (body?.sql || "").toString();
  const vars = (body?.vars || {}) as Record<string, unknown>;
  if (!sql) return NextResponse.json({ error: "Missing sql" }, { status: 400 });

  try {
    const result = await withSurreal(async (client) => client.query(sql, vars));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}


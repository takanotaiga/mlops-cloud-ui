// Utilities to normalize SurrealDB query responses into consistent arrays.

export function extractRows<T = any>(res: any): T[] {
  // Handles both shapes:
  // - [{ result: [...] }]
  // - [[ ... ]]
  if (!Array.isArray(res)) return []
  if (Array.isArray(res[0])) return res[0] as T[]
  if (Array.isArray((res as any)[0]?.result)) return (res as any)[0].result as T[]
  // Fallback: flatten any envelope-like results
  return (res as any[]).flatMap((r: any) => (Array.isArray(r?.result) ? r.result : Array.isArray(r) ? r : [])) as T[]
}

export function extractDatasetNames(res: any): string[] {
  const rows = extractRows<{ dataset?: unknown }>(res)
  const names = rows
    .map((r) => (typeof r?.dataset === "string" ? r.dataset : null))
    .filter((v): v is string => !!v)
  return Array.from(new Set(names))
}


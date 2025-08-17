import Surreal from "surrealdb";

export function getSurrealConfig() {
  return {
    url: process.env.SURREAL_URL || process.env.NEXT_PUBLIC_SURREAL_URL || "ws://taiga-macmini.local:65303/rpc",
    ns: process.env.SURREAL_NS || process.env.NEXT_PUBLIC_SURREAL_NS || "mlops",
    db: process.env.SURREAL_DB || process.env.NEXT_PUBLIC_SURREAL_DB || "cloud_ui",
    username: process.env.SURREAL_USER || process.env.NEXT_PUBLIC_SURREAL_USER || "root",
    password: process.env.SURREAL_PASS || process.env.NEXT_PUBLIC_SURREAL_PASS || "root",
  } as const;
}

export async function withSurreal<T>(fn: (client: Surreal) => Promise<T>): Promise<T> {
  const cfg = getSurrealConfig();
  const client = new (Surreal as any)();
  try {
    await client.connect(cfg.url);
    try {
      await client.signin({ username: cfg.username, password: cfg.password } as any);
    } catch {
      await client.signin({ user: cfg.username, pass: cfg.password } as any);
    }
    await client.use({ namespace: cfg.ns, database: cfg.db });
    return await fn(client);
  } finally {
    try { await client.close(); } catch { /* noop */ }
  }
}


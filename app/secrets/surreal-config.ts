// SurrealDB endpoint + auth config for client-side use
// Prefer setting these in .env.local as NEXT_PUBLIC_* variables
export const SURREAL_CONFIG = {
  // HTTP RPC URL (must include /rpc). Example: http://127.0.0.1:8000/rpc
  url: process.env.NEXT_PUBLIC_SURREAL_URL ?? "ws://taiga-macmini.local:65303/rpc",
  // Namespace and database
  ns: process.env.NEXT_PUBLIC_SURREAL_NS ?? "mlops",
  db: process.env.NEXT_PUBLIC_SURREAL_DB ?? "cloud_ui",
  // Basic auth (optional depending on server config)
  username: process.env.NEXT_PUBLIC_SURREAL_USER ?? "root",
  password: process.env.NEXT_PUBLIC_SURREAL_PASS ?? "root",
} as const

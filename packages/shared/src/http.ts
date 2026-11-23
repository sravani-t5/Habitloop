import { HttpError } from "./errors";

export interface CallOptions { method?: string; body?: unknown; token?: string; internal?: boolean; }

/** Tiny fetch wrapper for service-to-service HTTP calls. */
export async function callService<T = any>(url: string, opts: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.internal) headers["x-internal-key"] = process.env.INTERNAL_API_KEY || "";
  const r = await fetch(url, {
    method: opts.method || "GET", headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!r.ok) throw new HttpError(r.status, data?.error || `Upstream ${r.status} from ${url}`);
  return data as T;
}

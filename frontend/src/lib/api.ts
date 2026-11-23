const RAW = import.meta.env.VITE_API_BASE as string | undefined;
// "same-origin" = call /api/... on whatever host serves the page (used by Docker/Codespaces, where nginx proxies /api).
// On AWS set VITE_API_BASE to the ALB / CloudFront URL instead.
export const BASE: string = RAW === undefined || RAW === '' ? 'http://localhost:8080' : RAW === 'same-origin' ? '' : RAW.replace(/\/$/, '');

const KEY = 'habitloop.token';
export const getToken = () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY));
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...opts.headers };
  const t = getToken();
  if (t && opts.auth !== false) headers.authorization = `Bearer ${t}`;
  const r = await fetch(BASE + path, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data?.details?.fieldErrors ? Object.entries(data.details.fieldErrors).map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`).join('; ') : '';
    throw new ApiError(r.status, [data?.error ?? `Request failed (${r.status})`, detail].filter(Boolean).join(' - '));
  }
  return data as T;
}

export interface User { id: string; tenantId: string; email: string; name: string; role: string; tenantName?: string }
export interface Habit { id: string; name: string; description: string; frequencyPerWeek: number; scheduledTime: string; done7d: number; missed7d: number; lastLoggedAt: string | null }
export interface Summary { totalDone: number; totalMissed: number; completionRate: number; currentStreak: number; longestStreak: number; trend: { day: string; done: number; missed: number }[]; byHour: { hour: number; done: number; missed: number }[] }
export interface Challenge { id: string; title: string; description: string; visibility: 'public' | 'private'; goalTarget: number; startDate: string; endDate: string; ownerId: string; ownerName: string; participants: number; joined: boolean }
export interface Invite { id: string; challengeId: string; title: string; invitedBy: string; startDate: string; endDate: string }
export interface Integration { id: string; provider: string; deviceLabel: string; status: string; events: number }
export interface IntegrationEvent { id: string; eventId: string; status: 'RECEIVED' | 'PROCESSED' | 'REJECTED'; error: string | null; payload: { type: string; value: number }; receivedAt: string }
export interface Recommendation { id: string; activityId: string; activityName: string; type: 'timing' | 'frequency'; currentValue: string; suggestedValue: string; rationale: string; confidence: number; status: 'pending' | 'accepted' | 'dismissed' }
export interface LeaderRow { userId: string; name: string; done: number; progressPct: number }

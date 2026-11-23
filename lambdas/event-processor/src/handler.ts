/**
 * AWS Lambda (EventBridge target): validate -> enrich -> normalize partner events, then store them as activity logs.
 *  - Permanent problems (bad schema, stale event, no matching habit)  -> mark REJECTED, return normally (no retry)
 *  - Transient problems (Activity Service down / 5xx)                 -> throw, so EventBridge retries and finally uses the DLQ
 *  - Idempotency: the Activity Service dedupes on (tenantId, externalEventId)
 */
import { z } from "zod";

const detailSchema = z.object({
  internalId: z.string().uuid(), integrationId: z.string().uuid(), tenantId: z.string().uuid(), userId: z.string().uuid(),
  provider: z.string(), eventId: z.string().min(1),
  type: z.enum(["workout", "steps", "sleep", "meditation", "custom"]),
  value: z.number().nonnegative(), unit: z.string().optional(),
  timestamp: z.string().datetime({ offset: true }), activityId: z.string().uuid().optional(),
});

// Enrichment rules: what counts as "goal met" per event type, and how to find the user's matching habit
const RULES = {
  steps: { threshold: 5000, keywords: ["steps", "walk"] },
  workout: { threshold: 20, keywords: ["workout", "gym", "exercise", "run"] },
  sleep: { threshold: 6, keywords: ["sleep"] },
  meditation: { threshold: 5, keywords: ["meditat", "mindful"] },
  custom: { threshold: 1, keywords: [] as string[] },
} as const;

const ACTIVITY_URL = () => process.env.ACTIVITY_URL || "http://activity-service:3000";
const INTEGRATION_URL = () => process.env.INTEGRATION_URL || "http://integration-service:3000";
const hdr = () => ({ "content-type": "application/json", "x-internal-key": process.env.INTERNAL_API_KEY || "" });

async function markStatus(id: string | undefined, status: "PROCESSED" | "REJECTED", error?: string) {
  if (!id) return;
  const r = await fetch(`${INTEGRATION_URL()}/api/integrations/internal/events/${id}/status`, { method: "POST", headers: hdr(), body: JSON.stringify({ status, error }) });
  if (!r.ok) throw new Error(`status update failed ${r.status}`); // transient -> retry
}

export const handler = async (event: { detail: unknown }) => {
  const raw: any = event.detail;
  const parsed = detailSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = "invalid schema: " + parsed.error.issues.map((i) => i.path.join(".")).join(",");
    console.log(JSON.stringify({ level: "warn", msg, internalId: raw?.internalId }));
    await markStatus(raw?.internalId, "REJECTED", msg);
    return { status: "REJECTED", reason: msg };
  }
  const e = parsed.data;

  // validate: reject stale (>7 days) or future-dated (>5 min) events
  const age = Date.now() - Date.parse(e.timestamp);
  if (age > 7 * 86400_000 || age < -5 * 60_000) {
    await markStatus(e.internalId, "REJECTED", "timestamp out of accepted window");
    return { status: "REJECTED", reason: "timestamp" };
  }

  // enrich + normalize into the Activity Service log format
  const rule = RULES[e.type];
  const normalized = {
    tenantId: e.tenantId, userId: e.userId, externalEventId: `${e.integrationId}:${e.eventId}`,
    status: e.value >= rule.threshold ? "done" : "missed", loggedAt: e.timestamp,
    activityId: e.activityId, matchKeywords: e.activityId ? undefined : [...rule.keywords],
  };

  const r = await fetch(`${ACTIVITY_URL()}/api/activities/internal/logs`, { method: "POST", headers: hdr(), body: JSON.stringify(normalized) });
  if (r.status === 422 || r.status === 400) {
    const err = ((await r.json().catch(() => ({}))) as any).error || "rejected by activity service";
    await markStatus(e.internalId, "REJECTED", err);
    return { status: "REJECTED", reason: err };
  }
  if (!r.ok) throw new Error(`activity service ${r.status}`); // transient: let EventBridge retry / DLQ
  await markStatus(e.internalId, "PROCESSED");
  console.log(JSON.stringify({ level: "info", msg: "event processed", eventId: e.eventId, status: normalized.status }));
  return { status: "PROCESSED" };
};

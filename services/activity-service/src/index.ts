import { asyncHandler, authenticate, callService, createApp, ensureDatabase, getPool, HttpError, logger, migrate, requireInternal, RouteDoc, start, z } from "@habitloop/shared";

const routes: RouteDoc[] = [
  { method: "post", path: "", summary: "Create a habit", body: { name: "string", description: "string?", frequencyPerWeek: "integer?", scheduledTime: "string? (HH:MM)" } },
  { method: "get", path: "", summary: "List my habits (with last 7 days summary)" },
  { method: "get", path: "/:id", summary: "Get one habit" },
  { method: "patch", path: "/:id", summary: "Update habit / schedule rules", body: { name: "string?", description: "string?", frequencyPerWeek: "integer?", scheduledTime: "string?" } },
  { method: "delete", path: "/:id", summary: "Delete a habit" },
  { method: "post", path: "/:id/logs", summary: "Log done / missed / completed", body: { status: "string (done|missed|completed)", loggedAt: "string?" } },
  { method: "get", path: "/:id/logs", summary: "List logs for a habit" },
  { method: "post", path: "/internal/logs", auth: "internal", summary: "Idempotent log creation used by the event-processor Lambda", body: { tenantId: "string", userId: "string", externalEventId: "string", status: "string", loggedAt: "string", activityId: "string?", matchKeywords: "array?" } },
];

const SQL = `
CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  name text NOT NULL, description text NOT NULL DEFAULT '', frequency_per_week int NOT NULL DEFAULT 7,
  scheduled_time text NOT NULL DEFAULT '08:00', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_act_owner ON activities(tenant_id, user_id);
CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('done','missed','completed')),
  logged_at timestamptz NOT NULL DEFAULT now(), source text NOT NULL DEFAULT 'manual',
  external_event_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_logs_act ON activity_logs(activity_id, logged_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_log_external ON activity_logs(tenant_id, external_event_id) WHERE external_event_id IS NOT NULL;`;

const TZ = process.env.APP_TZ || "Asia/Kolkata";
const ANALYTICS_URL = process.env.ANALYTICS_URL || "http://analytics-service:3000";
const pool = getPool();
const { app, router } = createApp("activity-service", "/api/activities", routes, pool);

const toActivity = (a: any) => ({ id: a.id, name: a.name, description: a.description, frequencyPerWeek: a.frequency_per_week, scheduledTime: a.scheduled_time, createdAt: a.created_at });
const toLog = (l: any) => ({ id: l.id, activityId: l.activity_id, status: l.status, loggedAt: l.logged_at, source: l.source });
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const status = z.enum(["done", "missed", "completed"]);

function dayAndHour(d: Date) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d));
  return { day, hour };
}

/** Insert log + notify Analytics (fire-and-forget: analytics is eventually consistent and idempotent on logId). */
async function recordLog(a: { id: string; tenant_id: string; user_id: string }, st: string, at: Date, source: string, ext?: string) {
  const r = await pool.query(
    `INSERT INTO activity_logs(tenant_id,user_id,activity_id,status,logged_at,source,external_event_id)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *`,
    [a.tenant_id, a.user_id, a.id, st, at, source, ext ?? null]);
  const log = r.rows[0];
  if (!log) return { log: null, duplicate: true };
  callService(`${ANALYTICS_URL}/api/analytics/internal/events`, {
    method: "POST", internal: true,
    body: { logId: log.id, tenantId: a.tenant_id, userId: a.user_id, activityId: a.id, status: st, ...dayAndHour(at) },
  }).catch((e) => logger.warn({ err: e.message }, "analytics notify failed"));
  return { log, duplicate: false };
}

// ---- internal (declared first so "/internal" never matches "/:id") ----
router.post("/internal/logs", requireInternal, asyncHandler(async (req, res) => {
  const b = z.object({
    tenantId: z.string().uuid(), userId: z.string().uuid(), externalEventId: z.string().min(1), status,
    loggedAt: z.string().datetime({ offset: true }), activityId: z.string().uuid().optional(),
    matchKeywords: z.array(z.string()).optional(),
  }).parse(req.body);
  let a;
  if (b.activityId) {
    a = (await pool.query("SELECT * FROM activities WHERE id=$1 AND tenant_id=$2 AND user_id=$3", [b.activityId, b.tenantId, b.userId])).rows[0];
  } else if (b.matchKeywords?.length) {
    a = (await pool.query("SELECT * FROM activities WHERE tenant_id=$1 AND user_id=$2 AND name ILIKE ANY($3::text[]) ORDER BY created_at LIMIT 1",
      [b.tenantId, b.userId, b.matchKeywords.map((k) => `%${k}%`)])).rows[0];
  }
  if (!a) throw new HttpError(422, "No matching habit for this event");
  const { log, duplicate } = await recordLog(a, b.status, new Date(b.loggedAt), "wearable", b.externalEventId);
  res.status(duplicate ? 200 : 201).json({ duplicate, log: log && toLog(log) });
}));

// ---- user-facing ----
router.post("/", authenticate, asyncHandler(async (req, res) => {
  const b = z.object({
    name: z.string().min(1).max(100), description: z.string().max(500).optional(),
    frequencyPerWeek: z.number().int().min(1).max(7).optional(), scheduledTime: timeStr.optional(),
  }).parse(req.body);
  const r = await pool.query(
    "INSERT INTO activities(tenant_id,user_id,name,description,frequency_per_week,scheduled_time) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [req.ctx!.tenantId, req.ctx!.userId, b.name, b.description ?? "", b.frequencyPerWeek ?? 7, b.scheduledTime ?? "08:00"]);
  res.status(201).json(toActivity(r.rows[0]));
}));

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.ctx!;
  const r = await pool.query(
    `SELECT a.*,
       COUNT(l.*) FILTER (WHERE l.status IN ('done','completed') AND l.logged_at > now() - interval '7 days')::int AS done_7d,
       COUNT(l.*) FILTER (WHERE l.status='missed' AND l.logged_at > now() - interval '7 days')::int AS missed_7d,
       MAX(l.logged_at) AS last_logged_at
     FROM activities a LEFT JOIN activity_logs l ON l.activity_id=a.id
     WHERE a.tenant_id=$1 AND a.user_id=$2 GROUP BY a.id ORDER BY a.created_at DESC`, [tenantId, userId]);
  res.json(r.rows.map((a) => ({ ...toActivity(a), done7d: a.done_7d, missed7d: a.missed_7d, lastLoggedAt: a.last_logged_at })));
}));

async function owned(req: any) {
  const a = (await pool.query("SELECT * FROM activities WHERE id=$1 AND tenant_id=$2 AND user_id=$3",
    [req.params.id, req.ctx.tenantId, req.ctx.userId])).rows[0];
  if (!a) throw new HttpError(404, "Habit not found");
  return a;
}

router.get("/:id", authenticate, asyncHandler(async (req, res) => res.json(toActivity(await owned(req)))));

router.patch("/:id", authenticate, asyncHandler(async (req, res) => {
  const a = await owned(req);
  const b = z.object({
    name: z.string().min(1).max(100).optional(), description: z.string().max(500).optional(),
    frequencyPerWeek: z.number().int().min(1).max(7).optional(), scheduledTime: timeStr.optional(),
  }).parse(req.body);
  const r = await pool.query(
    "UPDATE activities SET name=$2, description=$3, frequency_per_week=$4, scheduled_time=$5 WHERE id=$1 RETURNING *",
    [a.id, b.name ?? a.name, b.description ?? a.description, b.frequencyPerWeek ?? a.frequency_per_week, b.scheduledTime ?? a.scheduled_time]);
  res.json(toActivity(r.rows[0]));
}));

router.delete("/:id", authenticate, asyncHandler(async (req, res) => {
  const a = await owned(req);
  await pool.query("DELETE FROM activities WHERE id=$1", [a.id]);
  res.status(204).end();
}));

router.post("/:id/logs", authenticate, asyncHandler(async (req, res) => {
  const a = await owned(req);
  const b = z.object({ status, loggedAt: z.string().datetime({ offset: true }).optional() }).parse(req.body);
  const { log } = await recordLog(a, b.status, b.loggedAt ? new Date(b.loggedAt) : new Date(), "manual");
  res.status(201).json(toLog(log));
}));

router.get("/:id/logs", authenticate, asyncHandler(async (req, res) => {
  const a = await owned(req);
  const r = await pool.query("SELECT * FROM activity_logs WHERE activity_id=$1 ORDER BY logged_at DESC LIMIT 200", [a.id]);
  res.json(r.rows.map(toLog));
}));

(async () => { await ensureDatabase(); await migrate(pool, SQL); start(app); })();

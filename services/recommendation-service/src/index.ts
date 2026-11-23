import { asyncHandler, authenticate, callService, createApp, ensureDatabase, getPool, HttpError, migrate, RouteDoc, start } from "@habitloop/shared";
import { Habit, HourStat, suggest } from "./engine";

const routes: RouteDoc[] = [
  { method: "post", path: "/generate", summary: "Analyse my history and (re)generate recommendations" },
  { method: "get", path: "", summary: "List my recommendations" },
  { method: "post", path: "/:id/accept", summary: "Accept: applies the new schedule to the habit via Activity Service" },
  { method: "post", path: "/:id/dismiss", summary: "Dismiss a recommendation" },
];

const SQL = `
CREATE TABLE IF NOT EXISTS recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, user_id uuid NOT NULL, activity_id uuid NOT NULL,
  activity_name text NOT NULL, type text NOT NULL CHECK (type IN ('timing','frequency')),
  current_value text NOT NULL, suggested_value text NOT NULL, rationale text NOT NULL, confidence numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed')), created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_rec_owner ON recommendations(tenant_id, user_id, status);`;

const ACTIVITY_URL = process.env.ACTIVITY_URL || "http://activity-service:3000";
const ANALYTICS_URL = process.env.ANALYTICS_URL || "http://analytics-service:3000";
const pool = getPool();
const { app, router } = createApp("recommendation-service", "/api/recommendations", routes, pool);
const toRec = (r: any) => ({ id: r.id, activityId: r.activity_id, activityName: r.activity_name, type: r.type, currentValue: r.current_value,
  suggestedValue: r.suggested_value, rationale: r.rationale, confidence: Number(r.confidence), status: r.status, createdAt: r.created_at });

router.post("/generate", authenticate, asyncHandler(async (req, res) => {
  const { tenantId, userId, token } = req.ctx!;
  const habits = await callService<Habit[]>(`${ACTIVITY_URL}/api/activities`, { token });
  await pool.query("DELETE FROM recommendations WHERE tenant_id=$1 AND user_id=$2 AND status='pending'", [tenantId, userId]);
  for (const h of habits) {
    const { hours } = await callService<{ hours: HourStat[] }>(`${ANALYTICS_URL}/api/analytics/hourly/${h.id}`, { token });
    for (const s of suggest(h, hours)) {
      await pool.query(
        `INSERT INTO recommendations(tenant_id,user_id,activity_id,activity_name,type,current_value,suggested_value,rationale,confidence)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tenantId, userId, h.id, h.name, s.type, s.currentValue, s.suggestedValue, s.rationale, s.confidence]);
    }
  }
  const r = await pool.query("SELECT * FROM recommendations WHERE tenant_id=$1 AND user_id=$2 AND status='pending' ORDER BY confidence DESC", [tenantId, userId]);
  res.json(r.rows.map(toRec));
}));

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const r = await pool.query("SELECT * FROM recommendations WHERE tenant_id=$1 AND user_id=$2 ORDER BY (status='pending') DESC, created_at DESC LIMIT 50",
    [req.ctx!.tenantId, req.ctx!.userId]);
  res.json(r.rows.map(toRec));
}));

async function pending(req: any) {
  const r = (await pool.query("SELECT * FROM recommendations WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND status='pending'",
    [req.params.id, req.ctx.tenantId, req.ctx.userId])).rows[0];
  if (!r) throw new HttpError(404, "Recommendation not found");
  return r;
}

router.post("/:id/accept", authenticate, asyncHandler(async (req, res) => {
  const r = await pending(req);
  const patch = r.type === "timing" ? { scheduledTime: r.suggested_value } : { frequencyPerWeek: parseInt(r.suggested_value, 10) };
  await callService(`${ACTIVITY_URL}/api/activities/${r.activity_id}`, { method: "PATCH", token: req.ctx!.token, body: patch });
  await pool.query("UPDATE recommendations SET status='accepted' WHERE id=$1", [r.id]);
  res.json({ ...toRec({ ...r, status: "accepted" }), applied: patch });
}));

router.post("/:id/dismiss", authenticate, asyncHandler(async (req, res) => {
  const r = await pending(req);
  await pool.query("UPDATE recommendations SET status='dismissed' WHERE id=$1", [r.id]);
  res.json(toRec({ ...r, status: "dismissed" }));
}));

(async () => { await ensureDatabase(); await migrate(pool, SQL); start(app); })();

import crypto from "crypto";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { asyncHandler, authenticate, createApp, getPool, HttpError, logger, migrate, requireInternal, RouteDoc, start, z } from "@habitloop/shared";

const routes: RouteDoc[] = [
  { method: "post", path: "", summary: "Connect a wearable / partner app. Returns a device token ONCE", body: { provider: "string", deviceLabel: "string?" } },
  { method: "get", path: "", summary: "List my connections" },
  { method: "delete", path: "/:id", summary: "Disconnect" },
  { method: "get", path: "/events/recent", summary: "My recent ingested events + processing status" },
  { method: "post", path: "/events", auth: "device", summary: "Partner/wearable event ingestion (idempotent on eventId)", body: { eventId: "string", type: "string (workout|steps|sleep|meditation|custom)", value: "number", unit: "string?", timestamp: "string (ISO-8601)", activityId: "string?" } },
  { method: "post", path: "/internal/events/:id/status", auth: "internal", summary: "Called by the Lambda to mark PROCESSED / REJECTED", body: { status: "string", error: "string?" } },
];

const SQL = `
CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  provider text NOT NULL, device_label text NOT NULL DEFAULT '', token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active', created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE, event_id text NOT NULL,
  payload jsonb NOT NULL, status text NOT NULL DEFAULT 'RECEIVED', error text,
  received_at timestamptz DEFAULT now(), processed_at timestamptz, UNIQUE (integration_id, event_id));`;

const pool = getPool();
const { app, router } = createApp("integration-service", "/api/integrations", routes, pool);
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const eb = new EventBridgeClient({ region: process.env.AWS_REGION || "ap-south-1" });

/** EVENT_BUS=eventbridge on AWS; locally the event goes straight to the Lambda running in a container. */
async function publish(detail: object) {
  if (process.env.EVENT_BUS === "eventbridge") {
    await eb.send(new PutEventsCommand({ Entries: [{
      Source: "habitloop.integration", DetailType: "PartnerEventReceived",
      EventBusName: process.env.EVENT_BUS_NAME || "default", Detail: JSON.stringify(detail),
    }] }));
  } else {
    const r = await fetch(process.env.LOCAL_PROCESSOR_URL || "http://event-processor:4000/invoke", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ detail }),
    });
    if (!r.ok) throw new Error(`processor ${r.status}`);
  }
}

router.post("/", authenticate, asyncHandler(async (req, res) => {
  const b = z.object({ provider: z.string().min(1).max(50), deviceLabel: z.string().max(100).optional() }).parse(req.body);
  const token = "hl_" + crypto.randomBytes(24).toString("hex");
  const r = (await pool.query(
    "INSERT INTO integrations(tenant_id,user_id,provider,device_label,token_hash) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [req.ctx!.tenantId, req.ctx!.userId, b.provider, b.deviceLabel ?? "", sha(token)])).rows[0];
  res.status(201).json({ id: r.id, provider: r.provider, deviceLabel: r.device_label, status: r.status, deviceToken: token });
}));

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const r = await pool.query(
    `SELECT i.*, (SELECT COUNT(*) FROM integration_events e WHERE e.integration_id=i.id) AS events
     FROM integrations i WHERE i.tenant_id=$1 AND i.user_id=$2 ORDER BY i.created_at DESC`, [req.ctx!.tenantId, req.ctx!.userId]);
  res.json(r.rows.map((i) => ({ id: i.id, provider: i.provider, deviceLabel: i.device_label, status: i.status, events: Number(i.events), createdAt: i.created_at })));
}));

router.get("/events/recent", authenticate, asyncHandler(async (req, res) => {
  const r = await pool.query(
    "SELECT * FROM integration_events WHERE tenant_id=$1 AND user_id=$2 ORDER BY received_at DESC LIMIT 20", [req.ctx!.tenantId, req.ctx!.userId]);
  res.json(r.rows.map((e) => ({ id: e.id, eventId: e.event_id, status: e.status, error: e.error, payload: e.payload, receivedAt: e.received_at })));
}));

router.delete("/:id", authenticate, asyncHandler(async (req, res) => {
  const r = await pool.query("DELETE FROM integrations WHERE id=$1 AND tenant_id=$2 AND user_id=$3", [req.params.id, req.ctx!.tenantId, req.ctx!.userId]);
  if (!r.rowCount) throw new HttpError(404, "Integration not found");
  res.status(204).end();
}));

const eventSchema = z.object({
  eventId: z.string().min(1).max(100),
  type: z.enum(["workout", "steps", "sleep", "meditation", "custom"]),
  value: z.number().nonnegative(), unit: z.string().max(20).optional(),
  timestamp: z.string().datetime({ offset: true }), activityId: z.string().uuid().optional(),
});

router.post("/events", asyncHandler(async (req, res) => {
  const token = String(req.headers["x-device-token"] || "");
  const integ = token && (await pool.query("SELECT * FROM integrations WHERE token_hash=$1 AND status='active'", [sha(token)])).rows[0];
  if (!integ) throw new HttpError(401, "Invalid device token");
  const ev = eventSchema.parse(req.body);

  // Idempotency: (integration_id, event_id) is unique -> a retried delivery returns the original record
  const ins = await pool.query(
    `INSERT INTO integration_events(tenant_id,user_id,integration_id,event_id,payload) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (integration_id, event_id) DO NOTHING RETURNING id`,
    [integ.tenant_id, integ.user_id, integ.id, ev.eventId, ev]);
  if (!ins.rowCount) {
    const prev = (await pool.query("SELECT id,status FROM integration_events WHERE integration_id=$1 AND event_id=$2", [integ.id, ev.eventId])).rows[0];
    return res.status(200).json({ id: prev.id, status: prev.status, duplicate: true });
  }
  const internalId = ins.rows[0].id;
  try {
    await publish({ internalId, integrationId: integ.id, tenantId: integ.tenant_id, userId: integ.user_id, provider: integ.provider, ...ev });
  } catch (e: any) {
    logger.error({ err: e.message, internalId }, "publish failed; event stays RECEIVED for replay");
  }
  res.status(202).json({ id: internalId, status: "RECEIVED", duplicate: false });
}));

router.post("/internal/events/:id/status", requireInternal, asyncHandler(async (req, res) => {
  const b = z.object({ status: z.enum(["PROCESSED", "REJECTED"]), error: z.string().max(500).optional() }).parse(req.body);
  await pool.query("UPDATE integration_events SET status=$2, error=$3, processed_at=now() WHERE id=$1", [req.params.id, b.status, b.error ?? null]);
  res.json({ ok: true });
}));

(async () => { await migrate(pool, SQL); start(app); })();

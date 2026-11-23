import { asyncHandler, authenticate, callService, createApp, getPool, HttpError, migrate, RouteDoc, start, z } from "@habitloop/shared";

const routes: RouteDoc[] = [
  { method: "post", path: "", summary: "Create challenge (public or private)", body: { title: "string", description: "string?", visibility: "string (public|private)", goalTarget: "integer", startDate: "string (YYYY-MM-DD)", endDate: "string (YYYY-MM-DD)" } },
  { method: "get", path: "", summary: "Challenge feed: public (my tenant) + mine + invited" },
  { method: "get", path: "/invites", summary: "Pending invites addressed to my email" },
  { method: "post", path: "/invites/:inviteId/accept", summary: "Accept an invite (joins the challenge)" },
  { method: "post", path: "/invites/:inviteId/decline", summary: "Decline an invite" },
  { method: "get", path: "/:id", summary: "Challenge detail + participants" },
  { method: "post", path: "/:id/join", summary: "Join a public challenge" },
  { method: "post", path: "/:id/invites", summary: "Invite someone by email (owner only)", body: { email: "string" } },
  { method: "get", path: "/:id/leaderboard", summary: "Challenge progress per participant (from Analytics)" },
];

const SQL = `
CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, owner_id uuid NOT NULL, owner_name text NOT NULL,
  title text NOT NULL, description text NOT NULL DEFAULT '', visibility text NOT NULL CHECK (visibility IN ('public','private')),
  goal_target int NOT NULL DEFAULT 20, start_date date NOT NULL, end_date date NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS participants (
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE, tenant_id uuid NOT NULL,
  user_id uuid NOT NULL, user_name text NOT NULL, joined_at timestamptz DEFAULT now(), PRIMARY KEY (challenge_id, user_id));
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL, inviter_id uuid NOT NULL, invitee_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')), created_at timestamptz DEFAULT now(),
  UNIQUE (challenge_id, invitee_email));`;

const ANALYTICS_URL = process.env.ANALYTICS_URL || "http://analytics-service:3000";
const pool = getPool();
const { app, router } = createApp("challenge-service", "/api/challenges", routes, pool);

const toChallenge = (c: any, extra: object = {}) => ({
  id: c.id, title: c.title, description: c.description, visibility: c.visibility, goalTarget: c.goal_target,
  startDate: c.start_date, endDate: c.end_date, ownerId: c.owner_id, ownerName: c.owner_name,
  participants: c.participant_count !== undefined ? Number(c.participant_count) : undefined, joined: c.joined, ...extra,
});
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

router.post("/", authenticate, asyncHandler(async (req, res) => {
  const b = z.object({
    title: z.string().min(1).max(120), description: z.string().max(500).optional(),
    visibility: z.enum(["public", "private"]), goalTarget: z.number().int().min(1).max(1000),
    startDate: dateStr, endDate: dateStr,
  }).refine((v) => v.endDate >= v.startDate, { message: "endDate must be after startDate" }).parse(req.body);
  const { tenantId, userId, name } = req.ctx!;
  const c = (await pool.query(
    `INSERT INTO challenges(tenant_id,owner_id,owner_name,title,description,visibility,goal_target,start_date,end_date)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tenantId, userId, name, b.title, b.description ?? "", b.visibility, b.goalTarget, b.startDate, b.endDate])).rows[0];
  await pool.query("INSERT INTO participants(challenge_id,tenant_id,user_id,user_name) VALUES($1,$2,$3,$4)", [c.id, tenantId, userId, name]);
  res.status(201).json(toChallenge(c, { participants: 1, joined: true }));
}));

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const { tenantId, userId, email } = req.ctx!;
  const r = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM participants p WHERE p.challenge_id=c.id) AS participant_count,
       EXISTS (SELECT 1 FROM participants p WHERE p.challenge_id=c.id AND p.user_id=$2) AS joined
     FROM challenges c
     WHERE c.tenant_id=$1 AND (c.visibility='public' OR c.owner_id=$2
        OR EXISTS (SELECT 1 FROM participants p WHERE p.challenge_id=c.id AND p.user_id=$2)
        OR EXISTS (SELECT 1 FROM invites i WHERE i.challenge_id=c.id AND i.invitee_email=$3 AND i.status='pending'))
     ORDER BY c.created_at DESC`, [tenantId, userId, email.toLowerCase()]);
  res.json(r.rows.map((c) => toChallenge(c)));
}));

router.get("/invites", authenticate, asyncHandler(async (req, res) => {
  const { tenantId, email } = req.ctx!;
  const r = await pool.query(
    `SELECT i.id, i.status, c.id AS challenge_id, c.title, c.description, c.owner_name, c.start_date, c.end_date
     FROM invites i JOIN challenges c ON c.id=i.challenge_id
     WHERE i.tenant_id=$1 AND i.invitee_email=$2 AND i.status='pending' ORDER BY i.created_at DESC`, [tenantId, email.toLowerCase()]);
  res.json(r.rows.map((i) => ({ id: i.id, challengeId: i.challenge_id, title: i.title, description: i.description, invitedBy: i.owner_name, startDate: i.start_date, endDate: i.end_date })));
}));

async function loadInvite(req: any) {
  const i = (await pool.query("SELECT * FROM invites WHERE id=$1 AND tenant_id=$2 AND invitee_email=$3 AND status='pending'",
    [req.params.inviteId, req.ctx.tenantId, req.ctx.email.toLowerCase()])).rows[0];
  if (!i) throw new HttpError(404, "Invite not found");
  return i;
}
router.post("/invites/:inviteId/accept", authenticate, asyncHandler(async (req, res) => {
  const i = await loadInvite(req);
  await pool.query("UPDATE invites SET status='accepted' WHERE id=$1", [i.id]);
  await pool.query("INSERT INTO participants(challenge_id,tenant_id,user_id,user_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [i.challenge_id, req.ctx!.tenantId, req.ctx!.userId, req.ctx!.name]);
  res.json({ accepted: true, challengeId: i.challenge_id });
}));
router.post("/invites/:inviteId/decline", authenticate, asyncHandler(async (req, res) => {
  const i = await loadInvite(req);
  await pool.query("UPDATE invites SET status='declined' WHERE id=$1", [i.id]);
  res.json({ declined: true });
}));

async function visible(req: any) {
  const { tenantId, userId, email } = req.ctx;
  const c = (await pool.query(
    `SELECT c.* FROM challenges c WHERE c.id=$1 AND c.tenant_id=$2 AND (c.visibility='public' OR c.owner_id=$3
       OR EXISTS (SELECT 1 FROM participants p WHERE p.challenge_id=c.id AND p.user_id=$3)
       OR EXISTS (SELECT 1 FROM invites i WHERE i.challenge_id=c.id AND i.invitee_email=$4))`,
    [req.params.id, tenantId, userId, email.toLowerCase()])).rows[0];
  if (!c) throw new HttpError(404, "Challenge not found"); // 404 (not 403) so other tenants cannot probe ids
  return c;
}

router.get("/:id", authenticate, asyncHandler(async (req, res) => {
  const c = await visible(req);
  const p = await pool.query("SELECT user_id, user_name, joined_at FROM participants WHERE challenge_id=$1 ORDER BY joined_at", [c.id]);
  res.json(toChallenge(c, { participantList: p.rows.map((x) => ({ userId: x.user_id, name: x.user_name, joinedAt: x.joined_at })), joined: p.rows.some((x) => x.user_id === req.ctx!.userId) }));
}));

router.post("/:id/join", authenticate, asyncHandler(async (req, res) => {
  const c = await visible(req);
  if (c.visibility === "private") throw new HttpError(403, "Private challenge: invite required");
  await pool.query("INSERT INTO participants(challenge_id,tenant_id,user_id,user_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [c.id, req.ctx!.tenantId, req.ctx!.userId, req.ctx!.name]);
  res.json({ joined: true });
}));

router.post("/:id/invites", authenticate, asyncHandler(async (req, res) => {
  const c = await visible(req);
  if (c.owner_id !== req.ctx!.userId) throw new HttpError(403, "Only the owner can invite");
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const r = await pool.query(
    `INSERT INTO invites(challenge_id,tenant_id,inviter_id,invitee_email) VALUES($1,$2,$3,$4)
     ON CONFLICT (challenge_id, invitee_email) DO UPDATE SET status='pending' RETURNING id`,
    [c.id, req.ctx!.tenantId, req.ctx!.userId, email.toLowerCase()]);
  res.status(201).json({ inviteId: r.rows[0].id });
}));

router.get("/:id/leaderboard", authenticate, asyncHandler(async (req, res) => {
  const c = await visible(req);
  const ps = (await pool.query("SELECT user_id, user_name FROM participants WHERE challenge_id=$1", [c.id])).rows;
  const fmt = (d: Date | string) => (d instanceof Date ? d.toLocaleDateString("en-CA") : String(d).slice(0, 10));
  const counts = await callService<{ userId: string; done: number }[]>(`${ANALYTICS_URL}/api/analytics/internal/leaderboard`, {
    method: "POST", internal: true,
    body: { tenantId: req.ctx!.tenantId, userIds: ps.map((p) => p.user_id), since: fmt(c.start_date), until: fmt(c.end_date) },
  });
  const board = ps.map((p) => {
    const done = counts.find((x) => x.userId === p.user_id)?.done ?? 0;
    return { userId: p.user_id, name: p.user_name, done, progressPct: Math.min(100, Math.round((done / c.goal_target) * 100)) };
  }).sort((a, b) => b.done - a.done);
  res.json({ challengeId: c.id, goalTarget: c.goal_target, leaderboard: board });
}));

(async () => { await migrate(pool, SQL); start(app); })();

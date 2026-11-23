import bcrypt from "bcryptjs";
import { asyncHandler, authenticate, createApp, getPool, HttpError, migrate, RouteDoc, signToken, start, z } from "@habitloop/shared";

const routes: RouteDoc[] = [
  { method: "post", path: "/auth/signup", auth: "none", summary: "Register. Send tenantName to create a new tenant, or tenantId to join one", body: { email: "string", password: "string", name: "string", tenantName: "string?", tenantId: "string?" } },
  { method: "post", path: "/auth/login", auth: "none", summary: "Login, returns JWT", body: { email: "string", password: "string" } },
  { method: "get", path: "/me", summary: "Current user + tenant" },
  { method: "get", path: "/members", summary: "Users in my tenant (tenant-isolated)" },
];

const SQL = `
CREATE TABLE IF NOT EXISTS tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL UNIQUE, password_hash text NOT NULL, name text NOT NULL,
  role text NOT NULL DEFAULT 'member', created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);`;

const pool = getPool();
const { app, router } = createApp("user-service", "/api/users", routes, pool);

const present = (u: any) => ({ id: u.id, tenantId: u.tenant_id, email: u.email, name: u.name, role: u.role });
const session = (u: any) => ({
  token: signToken({ userId: u.id, tenantId: u.tenant_id, email: u.email, name: u.name }),
  user: present(u),
});

router.post("/auth/signup", asyncHandler(async (req, res) => {
  const b = z.object({
    email: z.string().email(), password: z.string().min(8), name: z.string().min(1),
    tenantName: z.string().min(1).optional(), tenantId: z.string().uuid().optional(),
  }).refine((v) => v.tenantName || v.tenantId, { message: "tenantName or tenantId required" }).parse(req.body);

  const email = b.email.toLowerCase();
  if ((await pool.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount) throw new HttpError(409, "Email already registered");
  const hash = await bcrypt.hash(b.password, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let tenantId = b.tenantId, role = "member";
    if (b.tenantName) {
      tenantId = (await client.query("INSERT INTO tenants(name) VALUES($1) RETURNING id", [b.tenantName])).rows[0].id;
      role = "admin";
    } else if (!(await client.query("SELECT 1 FROM tenants WHERE id=$1", [tenantId])).rowCount) {
      throw new HttpError(404, "Tenant not found");
    }
    const u = (await client.query(
      "INSERT INTO users(tenant_id,email,password_hash,name,role) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [tenantId, email, hash, b.name, role])).rows[0];
    await client.query("COMMIT");
    res.status(201).json(session(u));
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}));

router.post("/auth/login", asyncHandler(async (req, res) => {
  const b = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const u = (await pool.query("SELECT * FROM users WHERE email=$1", [b.email.toLowerCase()])).rows[0];
  if (!u || !(await bcrypt.compare(b.password, u.password_hash))) throw new HttpError(401, "Invalid credentials");
  res.json(session(u));
}));

router.get("/me", authenticate, asyncHandler(async (req, res) => {
  const { userId, tenantId } = req.ctx!;
  const r = (await pool.query(
    "SELECT u.*, t.name AS tenant_name FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1 AND u.tenant_id=$2", [userId, tenantId])).rows[0];
  if (!r) throw new HttpError(404, "User not found");
  res.json({ ...present(r), tenantName: r.tenant_name });
}));

router.get("/members", authenticate, asyncHandler(async (req, res) => {
  const r = await pool.query("SELECT * FROM users WHERE tenant_id=$1 ORDER BY name", [req.ctx!.tenantId]);
  res.json(r.rows.map(present));
}));

(async () => { await migrate(pool, SQL); start(app); })();

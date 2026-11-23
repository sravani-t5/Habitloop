import { Pool, types } from "pg";
types.setTypeParser(1082, (v: string) => v); // DATE -> "YYYY-MM-DD"
import { logger } from "./logger";

/** DATABASE_URL, or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME (as injected from AWS Secrets Manager). */
export function getPool(): Pool {
  const ssl = process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined;
  if (process.env.DATABASE_URL) return new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 10 });
  return new Pool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl, max: 10,
  });
}

export async function migrate(pool: Pool, sql: string): Promise<void> {
  for (let i = 1; i <= 30; i++) {
    try { await pool.query(sql); return; }
    catch (e) {
      if (i === 30) throw e;
      logger.warn({ attempt: i }, "database not ready, retrying in 2s");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** On AWS the RDS instance starts with only the "postgres" database. Each service creates its own on first boot. */
export async function ensureDatabase(): Promise<void> {
  const name = process.env.DB_NAME;
  if (process.env.DB_AUTO_CREATE !== "true" || !name) return;
  const ssl = process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined;
  const admin = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: "postgres", ssl, max: 1 });
  try {
    for (let i = 1; i <= 30; i++) {
      try {
        const r = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
        if (!r.rowCount) await admin.query(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
        return;
      } catch (e: any) {
        if (e?.code === "42P04") return; // already exists (another replica won the race)
        if (i === 30) throw e;
        logger.warn({ attempt: i }, "database server not ready, retrying in 2s");
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  } finally { await admin.end(); }
}

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

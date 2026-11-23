import express, { Router } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { Pool } from "pg";
import { logger } from "./logger";
import { errorMiddleware } from "./errors";
import { buildOpenApi, RouteDoc } from "./docs";

export function createApp(name: string, prefix: string, routes: RouteDoc[], pool?: Pool) {
  process.env.SERVICE_NAME = name;
  logger.setBindings({ service: name });
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (r) => r.url === "/health" } }));

  // Health check (used by ALB target groups and docker-compose)
  app.get("/health", async (_req, res) => {
    try { if (pool) await pool.query("select 1"); res.json({ status: "ok", service: name }); }
    catch { res.status(503).json({ status: "db-unavailable", service: name }); }
  });

  const router = Router();
  app.use(prefix, router);
  const spec = buildOpenApi(name, prefix, routes);
  router.get("/openapi.json", (_req, res) => res.json(spec));
  router.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));
  return { app, router };
}

export function start(app: express.Express, port = Number(process.env.PORT || 3000)) {
  app.use(errorMiddleware);
  app.listen(port, () => logger.info({ port }, "service listening"));
}

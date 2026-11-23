import { ConditionalCheckFailedException, CreateTableCommand, DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { asyncHandler, authenticate, createApp, HttpError, logger, requireInternal, RouteDoc, start, z } from "@habitloop/shared";
import { computeStreaks } from "./streak";

const routes: RouteDoc[] = [
  { method: "get", path: "/summary", summary: "Completion rate, streaks, 30-day trend, best hours" },
  { method: "get", path: "/hourly/:activityId", summary: "Done/missed counts per hour of day for a habit (feeds Recommendations)" },
  { method: "post", path: "/internal/events", auth: "internal", summary: "Ingest an activity-log event (idempotent on logId)", body: { logId: "string", tenantId: "string", userId: "string", activityId: "string", status: "string", day: "string", hour: "integer" } },
  { method: "post", path: "/internal/leaderboard", auth: "internal", summary: "Done counts per user within a date range (Challenge Service)", body: { tenantId: "string", userIds: "array", since: "string", until: "string" } },
];

const TABLE = process.env.DDB_TABLE || "habitloop-analytics";
const REGION = process.env.AWS_REGION || "ap-south-1";
const endpoint = process.env.DYNAMODB_ENDPOINT || undefined;
const base = new DynamoDBClient({ region: REGION, endpoint, credentials: endpoint ? { accessKeyId: "local", secretAccessKey: "local" } : undefined });
const ddb = DynamoDBDocumentClient.from(base);

const { app, router } = createApp("analytics-service", "/api/analytics", routes);
const pk = (t: string, u: string) => `T#${t}#U#${u}`; // tenant id is part of every partition key => tenant isolation
const isDone = (s: string) => s === "done" || s === "completed";

async function ensureTable() {
  if (process.env.DDB_AUTO_CREATE !== "true") return;
  for (let i = 0; i < 30; i++) {
    try {
      try { await base.send(new DescribeTableCommand({ TableName: TABLE })); return; }
      catch { await base.send(new CreateTableCommand({ TableName: TABLE, BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }] })); return; }
    } catch (e) { logger.warn("dynamodb not ready, retrying"); await new Promise((r) => setTimeout(r, 2000)); }
  }
}

async function query(pkv: string, prefix: string, between?: [string, string]) {
  const items: any[] = []; let key: any;
  do {
    const r: any = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: between ? "pk=:p AND sk BETWEEN :a AND :b" : "pk=:p AND begins_with(sk,:s)",
      ExpressionAttributeValues: between ? { ":p": pkv, ":a": between[0], ":b": between[1] } : { ":p": pkv, ":s": prefix },
      ExclusiveStartKey: key }));
    items.push(...(r.Items || [])); key = r.LastEvaluatedKey;
  } while (key);
  return items;
}

router.post("/internal/events", requireInternal, asyncHandler(async (req, res) => {
  const b = z.object({ logId: z.string(), tenantId: z.string(), userId: z.string(), activityId: z.string(),
    status: z.enum(["done", "missed", "completed"]), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hour: z.number().int().min(0).max(23) }).parse(req.body);
  const p = pk(b.tenantId, b.userId);
  try { // idempotency marker: a replayed event can never be counted twice
    await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: p, sk: `LOG#${b.logId}`, ttl: Math.floor(Date.now() / 1000) + 30 * 86400 },
      ConditionExpression: "attribute_not_exists(pk)" }));
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException || (e as any)?.name === "ConditionalCheckFailedException") return res.json({ duplicate: true });
    throw e;
  }
  const col = isDone(b.status) ? "done" : "missed";
  const bump = (sk: string) => ddb.send(new UpdateCommand({ TableName: TABLE, Key: { pk: p, sk },
    UpdateExpression: "ADD #c :one", ExpressionAttributeNames: { "#c": col }, ExpressionAttributeValues: { ":one": 1 } }));
  await Promise.all([bump(`DAY#${b.day}`), bump(`HOUR#${b.activityId}#${String(b.hour).padStart(2, "0")}`)]);
  res.status(202).json({ duplicate: false });
}));

router.post("/internal/leaderboard", requireInternal, asyncHandler(async (req, res) => {
  const b = z.object({ tenantId: z.string(), userIds: z.array(z.string()).max(500), since: z.string(), until: z.string() }).parse(req.body);
  const out = await Promise.all(b.userIds.map(async (userId) => {
    const days = await query(pk(b.tenantId, userId), "", [`DAY#${b.since}`, `DAY#${b.until}`]);
    return { userId, done: days.reduce((n, d) => n + (d.done || 0), 0) };
  }));
  res.json(out);
}));

router.get("/summary", authenticate, asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.ctx!;
  const [dayItems, hourItems] = await Promise.all([query(pk(tenantId, userId), "DAY#"), query(pk(tenantId, userId), "HOUR#")]);
  const byDay = new Map(dayItems.map((d) => [String(d.sk).slice(4), { done: d.done || 0, missed: d.missed || 0 }]));
  const doneDays = new Set([...byDay].filter(([, v]) => v.done > 0).map(([k]) => k));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TZ || "Asia/Kolkata" }).format(new Date());
  const { current, longest } = computeStreaks(doneDays, today);
  const totalDone = [...byDay.values()].reduce((n, v) => n + v.done, 0);
  const totalMissed = [...byDay.values()].reduce((n, v) => n + v.missed, 0);
  const trend = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.parse(today + "T00:00:00Z") - (29 - i) * 86400000).toISOString().slice(0, 10);
    return { day: d, ...(byDay.get(d) || { done: 0, missed: 0 }) };
  });
  const hours = new Map<number, { done: number; missed: number }>();
  for (const h of hourItems) {
    const hr = Number(String(h.sk).split("#")[2]); const cur = hours.get(hr) || { done: 0, missed: 0 };
    hours.set(hr, { done: cur.done + (h.done || 0), missed: cur.missed + (h.missed || 0) });
  }
  const byHour = [...hours].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour);
  res.json({ totalDone, totalMissed, completionRate: totalDone + totalMissed ? Math.round((totalDone / (totalDone + totalMissed)) * 100) : 0,
    currentStreak: current, longestStreak: longest, trend, byHour });
}));

router.get("/hourly/:activityId", authenticate, asyncHandler(async (req, res) => {
  const { tenantId, userId } = req.ctx!;
  const items = await query(pk(tenantId, userId), `HOUR#${req.params.activityId}#`);
  res.json({ activityId: req.params.activityId, hours: items.map((i) => ({ hour: Number(String(i.sk).split("#")[2]), done: i.done || 0, missed: i.missed || 0 })) });
}));

(async () => { await ensureTable(); start(app); })();

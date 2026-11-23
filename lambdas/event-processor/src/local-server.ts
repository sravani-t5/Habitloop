// Local stand-in for "EventBridge -> Lambda" (docker-compose). On AWS this file is NOT used.
import express from "express";
import { handler } from "./handler";

const app = express();
app.use(express.json());
app.get("/health", (_q, r) => r.json({ status: "ok" }));
app.post("/invoke", async (req, res) => {
  try { res.json(await handler(req.body)); }
  catch (e: any) { console.error("handler error (EventBridge would retry):", e.message); res.status(500).json({ error: e.message }); }
});
const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`event-processor (local) on :${port}`));

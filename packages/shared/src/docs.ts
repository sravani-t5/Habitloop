export interface RouteDoc {
  method: "get" | "post" | "patch" | "delete" | "put";
  path: string;                       // relative to the service prefix, e.g. "/activities/:id"
  summary: string;
  auth?: "bearer" | "internal" | "device" | "none";
  body?: Record<string, string>;      // field -> type (suffix "?" = optional)
}

/** Builds an OpenAPI 3 document from a compact route list (served at <prefix>/docs). */
export function buildOpenApi(title: string, prefix: string, routes: RouteDoc[]) {
  const paths: Record<string, any> = {};
  for (const r of routes) {
    const p = prefix + r.path.replace(/:([A-Za-z]+)/g, "{$1}");
    const params = [...r.path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({
      name: m[1], in: "path", required: true, schema: { type: "string" },
    }));
    const op: any = { summary: r.summary, tags: [title], parameters: params, responses: { "200": { description: "OK" }, "400": { description: "Validation error" }, "401": { description: "Unauthorized" } } };
    const auth = r.auth ?? "bearer";
    if (auth === "bearer") op.security = [{ bearerAuth: [] }];
    if (auth === "internal") op.security = [{ internalKey: [] }];
    if (auth === "device") op.security = [{ deviceToken: [] }];
    if (r.body) {
      const properties: Record<string, any> = {}; const required: string[] = [];
      for (const [k, v] of Object.entries(r.body)) {
        const opt = v.endsWith("?"); const t = v.replace("?", "");
        properties[k] = t === "array" ? { type: "array", items: { type: "string" } } : { type: t };
        if (!opt) required.push(k);
      }
      op.requestBody = { required: true, content: { "application/json": { schema: { type: "object", properties, required } } } };
    }
    (paths[p] ||= {})[r.method] = op;
  }
  return {
    openapi: "3.0.3",
    info: { title: `HabitLoop ${title}`, version: "1.0.0" },
    components: { securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      internalKey: { type: "apiKey", in: "header", name: "x-internal-key" },
      deviceToken: { type: "apiKey", in: "header", name: "x-device-token" },
    } },
    paths,
  };
}

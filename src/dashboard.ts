import type { Express, Request, Response } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FlightRecorder, estimateTokens } from "./recorder.js";
import { BackendManager } from "./backends.js";
import { projectToolResult } from "./projection.js";
import { writeProjection, YdrisConfig } from "./config.js";

interface DashboardDeps {
  recorder: FlightRecorder;
  backends: BackendManager;
  cfg: YdrisConfig; // mutated in place when a rule is saved, so calls pick it up live
  configPath: string;
}

const here = dirname(fileURLToPath(import.meta.url));
// public/ ships alongside src/ and dist/ at the repo root, one level up from this file.
const htmlPath = join(here, "..", "public", "dashboard.html");

export function registerDashboard(app: Express, deps: DashboardDeps): void {
  const { recorder, backends, cfg, configPath } = deps;

  // The dashboard page itself. Read per request so edits show on refresh.
  app.get("/", (_req: Request, res: Response) => {
    try {
      res.type("html").send(readFileSync(htmlPath, "utf8"));
    } catch {
      res.status(500).type("text").send("Dashboard page not found. Is the public/ folder present?");
    }
  });

  // Live per-tool rollup plus whole-run totals for the header readouts.
  app.get("/api/stats", (_req: Request, res: Response) => {
    res.json({ totals: recorder.totals(), tools: recorder.summary() });
  });

  // Every tool behind the proxy, with whether a trimming rule already exists.
  app.get("/api/tools", (_req: Request, res: Response) => {
    const tools = backends.listRoutes().map((r) => ({
      exposedName: r.exposedName,
      backend: r.backend,
      originalName: r.originalName,
      inputSchema: r.definition?.inputSchema ?? { type: "object", properties: {} },
      description: r.definition?.description ?? "",
      hasRule: Boolean(cfg.projection[r.originalName] ?? cfg.projection[r.exposedName]),
      rule: cfg.projection[r.originalName] ?? cfg.projection[r.exposedName] ?? [],
    }));
    res.json({ tools });
  });

  // Call a tool once WITHOUT projection so the wizard can show every field.
  // This makes one real call to the backend.
  app.post("/api/probe", async (req: Request, res: Response) => {
    const { exposedName, args } = req.body ?? {};
    const route = backends.resolve(exposedName);
    if (!route) {
      res.status(404).json({ error: `No tool named ${exposedName}` });
      return;
    }
    try {
      const { result } = await backends.callWithRetry(route, args ?? {});
      res.json({ raw: result, rawTokens: estimateTokens(result) });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Preview what a set of field paths would trim the response down to, without saving.
  app.post("/api/preview", (req: Request, res: Response) => {
    const { raw, fields } = req.body ?? {};
    const trimmed = projectToolResult(raw, fields ?? []);
    res.json({ trimmed, trimmedTokens: estimateTokens(trimmed) });
  });

  // Save a trimming rule: write it to ydris.yaml AND apply it in memory so the
  // very next tool call is trimmed, no restart needed.
  app.post("/api/projection", (req: Request, res: Response) => {
    const { originalName, fields } = req.body ?? {};
    if (typeof originalName !== "string" || !Array.isArray(fields)) {
      res.status(400).json({ error: "Send originalName (string) and fields (array)." });
      return;
    }
    try {
      writeProjection(configPath, originalName, fields);
      if (fields.length === 0) {
        delete cfg.projection[originalName];
      } else {
        cfg.projection[originalName] = fields;
      }
      res.json({ ok: true, originalName, fields });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

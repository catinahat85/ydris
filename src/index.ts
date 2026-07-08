import express from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { BackendManager } from "./backends.js";
import { FlightRecorder, estimateTokens } from "./recorder.js";
import { projectToolResult } from "./projection.js";
import { registerDashboard } from "./dashboard.js";

const configPath = process.env.YDRIS_CONFIG ?? "./ydris.yaml";

// `ydris report` prints the per-tool rollup and exits.
if (process.argv[2] === "report") {
  const cfg = loadConfig(configPath);
  const rec = new FlightRecorder(cfg.dbPath);
  const rows = rec.summary();
  if (rows.length === 0) {
    console.log("No calls recorded yet.");
  } else {
    console.table(rows);
  }
  rec.close();
  process.exit(0);
}

async function main() {
  const cfg = loadConfig(configPath);
  const recorder = new FlightRecorder(cfg.dbPath);
  const backends = new BackendManager();
  await backends.start(cfg.backends);

  const server = new Server(
    { name: "ydris", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: backends.listExposedTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const exposedName = req.params.name;
    const args = req.params.arguments ?? {};
    const route = backends.resolve(exposedName);

    if (!route) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${exposedName}` }],
      };
    }

    const reqTokens = estimateTokens(args);
    const started = performance.now();
    let attempts = 0;
    let ok = false;
    let errorText: string | null = null;
    let rawResult: any = null;
    let finalResult: any;

    try {
      const call = await backends.callWithRetry(route, args);
      attempts = call.attempts;
      rawResult = call.result;
      ok = !(rawResult?.isError === true);

      const fields = cfg.projection[route.originalName] ?? cfg.projection[exposedName];
      finalResult = fields ? projectToolResult(rawResult, fields) : rawResult;
    } catch (err) {
      attempts = cfg.backends.find((b) => b.name === route.backend)!.retry.maxAttempts;
      errorText = err instanceof Error ? err.message : String(err);
      finalResult = {
        isError: true,
        content: [{ type: "text", text: `Backend "${route.backend}" failed: ${errorText}` }],
      };
    }

    recorder.record({
      backend: route.backend,
      tool: route.originalName,
      ok,
      attempts,
      latencyMs: performance.now() - started,
      reqTokensEst: reqTokens,
      respTokensRawEst: estimateTokens(rawResult),
      respTokensTrimmedEst: estimateTokens(finalResult),
      errorText,
    });

    return finalResult;
  });

  // One MCP transport instance per session, keyed by the MCP session header.
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const app = express();
  app.use(express.json({ limit: "16mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, backends: cfg.backends.map((b) => b.name) }));

  // Beginner-facing control panel: live stats + the field-picker wizard.
  registerDashboard(app, { recorder, backends, cfg, configPath });

  app.all("/mcp", async (req, res) => {
    const sid = req.header("mcp-session-id");
    let transport = sid ? transports.get(sid) : undefined;

    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => {
          transports.set(id, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      await server.connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(cfg.port, () => {
    console.error(`[ydris] listening on http://127.0.0.1:${cfg.port}/mcp`);
    console.error(`[ydris] control panel: http://127.0.0.1:${cfg.port}/`);
    console.error(`[ydris] point your MCP client at the /mcp URL. Run "ydris report" for a terminal readout.`);
  });

  const shutdown = async () => {
    console.error("\n[ydris] shutting down");
    await backends.stop();
    recorder.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[ydris] fatal:", err);
  process.exit(1);
});

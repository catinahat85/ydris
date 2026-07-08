// Full dashboard test: probe a tool, preview a trim, save the rule through the
// wizard endpoint, then confirm a real MCP call is trimmed live and stats update.
// Run with the server up against test/fake-backend.mjs (see ydris.example.yaml).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = "http://127.0.0.1:9280";
const j = async (r) => { const d = await r.json(); if (!r.ok) throw new Error(JSON.stringify(d)); return d; };
const post = (path, body) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(j);
const get = (path) => fetch(BASE + path).then(j);

function tokenOf(result) {
  const t = (result.content || []).find((c) => c.type === "text")?.text ?? "";
  return Math.ceil(t.length / 4);
}

let pass = 0, fail = 0;
const check = (label, cond, detail = "") => {
  if (cond) { console.log(`  PASS  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}  ${detail}`); fail++; }
};

console.log("\n== Dashboard API + live-trim test ==\n");

const t0 = await get("/api/tools");
const tool = t0.tools[0];
check("tools enumerate", Boolean(tool?.originalName), JSON.stringify(t0));
check("tool starts untrimmed", tool.hasRule === false);

const probe = await post("/api/probe", { exposedName: tool.exposedName, args: { query: "vp eng" } });
check("probe returns raw response", tokenOf(probe.raw) > 200, "rawTokens=" + probe.rawTokens);
const rawTokens = probe.rawTokens;

const preview = await post("/api/preview", { raw: probe.raw, fields: ["records[].name", "records[].email"] });
check("preview trims tokens down", preview.trimmedTokens < rawTokens && preview.trimmedTokens > 0, "trimmed=" + preview.trimmedTokens);
check("preview keeps only chosen fields", preview.trimmed.content[0].text.includes("email") && !preview.trimmed.content[0].text.includes("employment_history"));

const fields = ["records[].name", "records[].title", "records[].email", "records[].organization.name"];
const saved = await post("/api/projection", { originalName: tool.originalName, fields });
check("save endpoint returns ok", saved.ok === true);

const t1 = await get("/api/tools");
check("tool now trimmed (no restart)", t1.tools[0].hasRule === true);
check("rule persisted with 4 fields", t1.tools[0].rule.length === 4);

const mcp = new Client({ name: "dash-test", version: "0.0.1" });
await mcp.connect(new StreamableHTTPClientTransport(new URL(BASE + "/mcp")));
const live = await mcp.callTool({ name: tool.exposedName, arguments: { query: "vp eng" } });
const liveTokens = tokenOf(live);
check("live MCP call trimmed by saved rule", liveTokens < 80, "liveTokens=" + liveTokens);
check("live result dropped fat fields", !live.content[0].text.includes("employment_history"));
await mcp.close();

await new Promise((r) => setTimeout(r, 300));
const stats = await get("/api/stats");
check("stats show calls recorded", stats.totals.calls >= 1);
check("stats show tokens saved > 0", stats.totals.tokensSaved > 0, "saved=" + stats.totals.tokensSaved);

console.log(`\n== ${pass} passed, ${fail} failed ==`);
console.log(`Live call went from ~${rawTokens} raw tokens to ${liveTokens} trimmed.\n`);
process.exit(fail === 0 ? 0 : 1);

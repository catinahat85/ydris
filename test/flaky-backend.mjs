// Fails the first 2 calls with a 429, succeeds on the 3rd. Proves retry+backoff.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
let n = 0;
const server = new Server({ name: "flaky", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "ping", description: "flaky ping", inputSchema: { type: "object", properties: {} } }],
}));
server.setRequestHandler(CallToolRequestSchema, async () => {
  n++;
  if (n < 3) throw new Error("HTTP 429 rate limit exceeded, retry later");
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, servedOnAttempt: n }) }] };
});
await server.connect(new StdioServerTransport());

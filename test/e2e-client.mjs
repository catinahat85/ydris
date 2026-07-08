// Connects to a running Ydris over streamable HTTP, lists tools, calls the
// test tool, and reports raw-vs-trimmed size so you can see projection work.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL("http://127.0.0.1:9280/mcp");
const client = new Client({ name: "ydris-test-client", version: "0.0.1" });
await client.connect(new StreamableHTTPClientTransport(url));

const { tools } = await client.listTools();
console.log("Tools exposed through Ydris:", tools.map((t) => t.name));

const res = await client.callTool({
  name: "backend-a__record_search",
  arguments: { query: "vp engineering" },
});

const text = res.content.find((c) => c.type === "text")?.text ?? "";
const parsed = JSON.parse(text);

console.log("\n--- Response returned to the client (post-projection) ---");
console.log(JSON.stringify(parsed, null, 2));
console.log(`\nTrimmed response size: ${text.length} chars (~${Math.ceil(text.length / 4)} tokens)`);

await client.close();
process.exit(0);

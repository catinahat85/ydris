# Ydris

**An open source, vendor-agnostic MCP governance proxy. It runs on your machine and governs the last mile of tool traffic for every agent you use.**

Ydris is MIT licensed and beholden to no vendor. It sits between your AI clients and your MCP tool servers as one local process, so whatever model you run and whatever tools you connect, the projection, metering, and retry all happen on your side of the wire under your control.

---

## The pain point

MCP made it trivial to plug tools into agents, and that same ease created three problems nobody owns.

Tool responses are fat, and the whole blob lands in your context. An API returns forty fields when your agent needed four, and you pay for every token of the thirty-six you threw away, and a big enough response can overflow the window and crash the run outright.

You cannot see what any single tool costs you. Your provider dashboard reports tokens at the model level and attributes nothing to a specific tool or server, so you're metering a workflow by screenshot and guessing which call is bleeding you.

One rate-limited call kills the whole job. An upstream server throws a 429 and swallows the backoff signal, and your multi-step run dies on a transient hiccup that a retry would have cleared.

The gateways that solve this were built for platform teams running Kubernetes, and they govern the servers routed through the platform while the stdio tool you spun up on your laptop stays invisible to them. That last mile runs ungoverned whether you're one person running a handful of tools or an enterprise with thousands of employees quietly wiring up their own MCP servers.

## Our solution

Ydris wears two faces in one process. It's an HTTP MCP server to any client, and an MCP client to any backend. Your agents point at one localhost endpoint, your tool servers hang behind it, and three policies apply in the middle on every request and every response.

Declarative response projection trims each tool result down to the fields you name in a config file, before the payload ever reaches the model. This is the piece almost nothing else in the MCP ecosystem does, and it's the one that kills the token bloat at the source.

A local flight recorder logs every call to SQLite with success rate, latency, and token estimates on both directions, so you read your real per-tool cost from your own machine without shipping telemetry to anyone.

Per-backend retry with exponential backoff catches the transient failures and the rate-limit signals that upstream servers throw away, so a 429 means a short wait instead of a dead workflow.

```
  BrowserOS ─┐
  Claude Code┤
  Goose      ┼──HTTP──▶  Ydris   ──┬──stdio──▶  backend A
  Codex      ┤          /mcp        │
  Cursor    ─┘         (projection, ├──stdio──▶  backend B
                        metering,   │
                        retry)      └──stdio──▶  any MCP server
```

Everything stays MCP-compliant on both faces, so Ydris introduces no new protocol and locks you into nothing. Any client that speaks HTTP MCP works, and any server you can start locally sits behind it regardless of who built it.

## The outcome

You stop paying for tokens you never wanted, and in testing a single fat response dropped from 406 tokens to 47 through one projection rule. You get a per-tool cost and reliability number you can actually read, pulled from a local database you own. Your runs survive the rate limits that used to end them. And you hold all of it on your own hardware under an open license, with no vendor sitting in the middle of your tool traffic deciding what you can see or where your data goes.

For a hobbyist that means a cheaper, calmer local agent stack that stops crashing on bloated payloads. For an enterprise it means governance at the endpoint where the call actually happens, covering the machines a central gateway was never able to see, with logs it can ship upstream to whatever compliance pipeline already runs.

## Who it's for

Solo builders and hobbyists running local agents who want their tool calls cheaper, quieter, and legible without standing up platform infrastructure. And enterprises that need the ungoverned last mile brought under control on every employee's machine, without forcing a single vendor's stack on anyone.

## Install

```bash
git clone <your-repo-url> ydris && cd ydris
npm install
npm run build
```

## Configure

Copy the example and edit it. Your real config is gitignored, so secrets and backend names never enter git history.

```bash
cp ydris.example.yaml ydris.yaml
```

```yaml
port: 9280
dbPath: ./ydris.db

backends:
  - name: backend-a
    command: node
    args: ["path/to/your-mcp-wrapper.mjs"]
    env:
      SOME_API_KEY: "set-this-in-your-real-ydris-yaml"
    retry:
      maxAttempts: 3
      baseDelayMs: 300
      maxDelayMs: 5000

# Trim each tool's response down to only the fields you need.
# Use [] for array fan-out: "records[].email" keeps email on every element.
projection:
  record_search:
    - "records[].name"
    - "records[].title"
    - "records[].email"
    - "records[].organization.name"
```

## Run

```bash
npm start
```

Point any MCP client at `http://127.0.0.1:9280/mcp`, and the tools from every backend show up namespaced as `<backend>__<tool>` so two servers never collide.

## Read your stats

```bash
node dist/index.js report
```

```
┌─────────┬─────────────────┬────────────┬───────┬─────────────┬────────┬────────────┬────────────────┬──────────────┐
│ (index) │ tool            │ backend    │ calls │ success_pct │ avg_ms │ raw_tokens │ trimmed_tokens │ tokens_saved │
├─────────┼─────────────────┼────────────┼───────┼─────────────┼────────┼────────────┼────────────────┼──────────────┤
│ 0       │ 'record_search' │ 'backend-a'│ 1     │ 100         │ 12     │ 406        │ 47             │ 359          │
└─────────┴─────────────────┴────────────┴───────┴─────────────┴────────┴────────────┴────────────────┴──────────────┘
```

## v0 scope

This release does projection, metering, and retry across stdio backends. Fleet config sync across machines and a provider-quirks registry are the next modules, and they build on the same config surface.

## License

MIT. Use it, fork it, ship it.

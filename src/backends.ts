import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BackendConfig, RetryConfig } from "./config.js";

export interface RoutedTool {
  exposedName: string; // what the client sees, namespaced: "<backend>__<tool>"
  backend: string;
  originalName: string;
  definition: any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Detect an upstream rate-limit / transient signal from an error or an error-result.
function isTransient(err: unknown, result: any): boolean {
  const text = (
    (err instanceof Error ? err.message : String(err ?? "")) +
    " " +
    JSON.stringify(result ?? "")
  ).toLowerCase();
  return (
    text.includes("429") ||
    text.includes("rate limit") ||
    text.includes("rate-limit") ||
    text.includes("too many requests") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("503") ||
    text.includes("temporarily")
  );
}

export class BackendManager {
  private clients = new Map<string, Client>();
  private retryByBackend = new Map<string, RetryConfig>();
  private toolIndex = new Map<string, RoutedTool>();

  async start(backends: BackendConfig[]): Promise<void> {
    for (const b of backends) {
      await this.connectBackend(b);
    }
    await this.refreshTools();
  }

  private async connectBackend(b: BackendConfig): Promise<void> {
    const client = new Client({ name: `ydris-${b.name}`, version: "0.0.1" });
    const transport = new StdioClientTransport({
      command: b.command,
      args: b.args,
      env: { ...process.env, ...b.env } as Record<string, string>,
    });
    await client.connect(transport);
    this.clients.set(b.name, client);
    this.retryByBackend.set(b.name, b.retry);
    console.error(`[ydris] connected backend "${b.name}"`);
  }

  // Connect a single new backend at runtime and fold its tools into the index.
  // Throws (without mutating state beyond a failed client) if the connect fails,
  // so callers can decide whether to roll back a config write.
  async addBackend(b: BackendConfig): Promise<void> {
    await this.connectBackend(b);
    await this.refreshTools();
  }

  // Stop and disconnect one backend by name, dropping its tools from the index.
  async removeBackend(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.delete(name);
    this.retryByBackend.delete(name);
    await this.refreshTools();
  }

  isConnected(name: string): boolean {
    return this.clients.has(name);
  }

  async refreshTools(): Promise<void> {
    this.toolIndex.clear();
    for (const [name, client] of this.clients) {
      const { tools } = await client.listTools();
      for (const t of tools) {
        const exposed = `${name}__${t.name}`;
        this.toolIndex.set(exposed, {
          exposedName: exposed,
          backend: name,
          originalName: t.name,
          definition: { ...t, name: exposed },
        });
      }
      console.error(`[ydris] "${name}" exposes ${tools.length} tool(s)`);
    }
  }

  listExposedTools(): any[] {
    return [...this.toolIndex.values()].map((r) => r.definition);
  }

  // Full route metadata for the dashboard: exposed name, backend, original name, schema.
  listRoutes(): RoutedTool[] {
    return [...this.toolIndex.values()];
  }

  resolve(exposedName: string): RoutedTool | undefined {
    return this.toolIndex.get(exposedName);
  }

  // Call a backend tool with retry + exponential backoff on transient failures.
  async callWithRetry(
    route: RoutedTool,
    args: unknown
  ): Promise<{ result: any; attempts: number }> {
    const retry = this.retryByBackend.get(route.backend)!;
    const client = this.clients.get(route.backend)!;
    let attempt = 0;
    let lastErr: unknown;

    while (attempt < retry.maxAttempts) {
      attempt++;
      try {
        const result = await client.callTool({
          name: route.originalName,
          arguments: (args ?? {}) as Record<string, unknown>,
        });
        if ((result as any)?.isError && isTransient(null, result) && attempt < retry.maxAttempts) {
          await sleep(backoff(retry, attempt));
          continue;
        }
        return { result, attempts: attempt };
      } catch (err) {
        lastErr = err;
        if (isTransient(err, null) && attempt < retry.maxAttempts) {
          await sleep(backoff(retry, attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error("retry exhausted");
  }

  async stop(): Promise<void> {
    for (const c of this.clients.values()) {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
    }
  }
}

function backoff(retry: RetryConfig, attempt: number): number {
  const raw = retry.baseDelayMs * 2 ** (attempt - 1);
  const jitter = Math.random() * retry.baseDelayMs;
  return Math.min(retry.maxDelayMs, raw + jitter);
}

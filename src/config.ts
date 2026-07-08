import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface BackendConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  retry: RetryConfig;
}

// projection[toolName] = ["field.path", "other.field"] -> only these survive
export interface YdrisConfig {
  port: number;
  dbPath: string;
  backends: BackendConfig[];
  projection: Record<string, string[]>;
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
};

export function loadConfig(path: string): YdrisConfig {
  if (!existsSync(path)) {
    throw new Error(`Ydris config not found at ${path}. Copy ydris.example.yaml to ${path} first.`);
  }
  const raw = parse(readFileSync(path, "utf8")) ?? {};

  const backends: BackendConfig[] = (raw.backends ?? []).map((b: any) => {
    if (!b.name || !b.command) {
      throw new Error(`Each backend needs a name and a command. Offending entry: ${JSON.stringify(b)}`);
    }
    return {
      name: b.name,
      command: b.command,
      args: b.args ?? [],
      env: b.env ?? {},
      retry: { ...DEFAULT_RETRY, ...(b.retry ?? {}) },
    };
  });

  if (backends.length === 0) {
    throw new Error("Ydris needs at least one backend in ydris.yaml.");
  }

  return {
    port: raw.port ?? 9280,
    dbPath: raw.dbPath ?? "./ydris.db",
    backends,
    projection: raw.projection ?? {},
  };
}

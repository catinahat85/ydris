import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";

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

// Persist a single projection rule back into ydris.yaml, preserving the rest of
// the file's data. The wizard calls this when a user saves field selections.
// Note: this rewrites the file through the YAML serializer, so hand-written
// comments in the projection block are not preserved.
export function writeProjection(path: string, toolName: string, fields: string[]): void {
  const raw = existsSync(path) ? parse(readFileSync(path, "utf8")) ?? {} : {};
  raw.projection = raw.projection ?? {};
  if (fields.length === 0) {
    delete raw.projection[toolName];
  } else {
    raw.projection[toolName] = fields;
  }
  writeFileSync(path, stringify(raw), "utf8");
}

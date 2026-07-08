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

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
};

// Validate and apply defaults to one backend entry. Shared by config loading
// and the dashboard's "add a server" API so both paths agree on what a
// well-formed backend looks like.
export function normalizeBackend(b: any): BackendConfig {
  if (!b?.name || !b?.command) {
    throw new Error(`Each backend needs a name and a command. Offending entry: ${JSON.stringify(b)}`);
  }
  return {
    name: b.name,
    command: b.command,
    args: b.args ?? [],
    env: b.env ?? {},
    retry: { ...DEFAULT_RETRY, ...(b.retry ?? {}) },
  };
}

export function loadConfig(path: string): YdrisConfig {
  if (!existsSync(path)) {
    throw new Error(`Ydris config not found at ${path}. Copy ydris.example.yaml to ${path} first.`);
  }
  const raw = parse(readFileSync(path, "utf8")) ?? {};

  const backends: BackendConfig[] = (raw.backends ?? []).map(normalizeBackend);

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

// Add or replace a backend entry by name, preserving the rest of the file.
export function writeBackend(path: string, backend: BackendConfig): void {
  const raw = existsSync(path) ? parse(readFileSync(path, "utf8")) ?? {} : {};
  raw.backends = raw.backends ?? [];
  const idx = raw.backends.findIndex((b: any) => b.name === backend.name);
  if (idx === -1) {
    raw.backends.push(backend);
  } else {
    raw.backends[idx] = backend;
  }
  writeFileSync(path, stringify(raw), "utf8");
}

// Delete one backend entry by name, preserving the rest of the file.
export function removeBackend(path: string, name: string): void {
  const raw = existsSync(path) ? parse(readFileSync(path, "utf8")) ?? {} : {};
  raw.backends = (raw.backends ?? []).filter((b: any) => b.name !== name);
  writeFileSync(path, stringify(raw), "utf8");
}

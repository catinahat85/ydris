import Database from "better-sqlite3";

export interface CallRecord {
  backend: string;
  tool: string;
  ok: boolean;
  attempts: number;
  latencyMs: number;
  reqTokensEst: number;
  respTokensRawEst: number;
  respTokensTrimmedEst: number;
  errorText: string | null;
}

// Rough token estimate. Good enough for relative per-tool cost tracking.
// ~4 chars per token is the standard back-of-envelope for English + JSON.
export function estimateTokens(payload: unknown): number {
  const s = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  return Math.ceil(s.length / 4);
}

export class FlightRecorder {
  private db: Database.Database;
  private insert: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL DEFAULT (datetime('now')),
        backend TEXT NOT NULL,
        tool TEXT NOT NULL,
        ok INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        req_tokens_est INTEGER NOT NULL,
        resp_tokens_raw_est INTEGER NOT NULL,
        resp_tokens_trimmed_est INTEGER NOT NULL,
        tokens_saved_est INTEGER NOT NULL,
        error_text TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_calls_tool ON calls(tool);
      CREATE INDEX IF NOT EXISTS idx_calls_backend ON calls(backend);
    `);
    this.insert = this.db.prepare(`
      INSERT INTO calls
        (backend, tool, ok, attempts, latency_ms, req_tokens_est,
         resp_tokens_raw_est, resp_tokens_trimmed_est, tokens_saved_est, error_text)
      VALUES
        (@backend, @tool, @ok, @attempts, @latencyMs, @reqTokensEst,
         @respTokensRawEst, @respTokensTrimmedEst, @tokensSaved, @errorText)
    `);
  }

  record(r: CallRecord): void {
    this.insert.run({
      backend: r.backend,
      tool: r.tool,
      ok: r.ok ? 1 : 0,
      attempts: r.attempts,
      latencyMs: Math.round(r.latencyMs),
      reqTokensEst: r.reqTokensEst,
      respTokensRawEst: r.respTokensRawEst,
      respTokensTrimmedEst: r.respTokensTrimmedEst,
      tokensSaved: Math.max(0, r.respTokensRawEst - r.respTokensTrimmedEst),
      errorText: r.errorText,
    });
  }

  // Per-tool rollup, printed on demand so you can read a run without a dashboard.
  summary(): Array<Record<string, unknown>> {
    return this.db
      .prepare(`
        SELECT
          tool,
          backend,
          COUNT(*) AS calls,
          ROUND(100.0 * SUM(ok) / COUNT(*), 1) AS success_pct,
          ROUND(AVG(latency_ms)) AS avg_ms,
          SUM(resp_tokens_raw_est) AS raw_tokens,
          SUM(resp_tokens_trimmed_est) AS trimmed_tokens,
          SUM(tokens_saved_est) AS tokens_saved
        FROM calls
        GROUP BY tool, backend
        ORDER BY calls DESC
      `)
      .all() as Array<Record<string, unknown>>;
  }

  // Whole-run aggregate for the dashboard header readouts.
  totals(): { calls: number; successPct: number; tokensSaved: number; rawTokens: number } {
    const row = this.db
      .prepare(`
        SELECT
          COUNT(*) AS calls,
          COALESCE(ROUND(100.0 * SUM(ok) / COUNT(*), 1), 100) AS success_pct,
          COALESCE(SUM(tokens_saved_est), 0) AS tokens_saved,
          COALESCE(SUM(resp_tokens_raw_est), 0) AS raw_tokens
        FROM calls
      `)
      .get() as any;
    return {
      calls: row.calls ?? 0,
      successPct: row.success_pct ?? 100,
      tokensSaved: row.tokens_saved ?? 0,
      rawTokens: row.raw_tokens ?? 0,
    };
  }

  close(): void {
    this.db.close();
  }
}

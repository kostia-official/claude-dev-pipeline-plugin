/**
 * Append-only NDJSON logger for plugin scripts.
 *
 * Logs live at `/tmp/dp-logs/<YYYY-MM-DD>.ndjson` — one daily file across
 * all projects on the machine. Every call also mirrors the line to stderr
 * so the host extension (Claude Code / Cursor) surfaces it in its Output
 * panel for live visibility.
 *
 * Best-effort: every call swallows its own errors so logging failure
 * never breaks a hook or CLI invocation.
 *
 * Each line is a single JSON object:
 *   { ts, src, level, ...data }
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const LOGS_DIR = "/tmp/dp-logs";

export type LogLevel = "info" | "warn" | "error";

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function logsFile(): string {
  return join(LOGS_DIR, `${todayStamp()}.ndjson`);
}

export function logsPathForCwd(): string {
  return logsFile();
}

export function log(level: LogLevel, src: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    src,
    level,
    ...data,
  });
  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(logsFile(), `${line}\n`);
  } catch {
    // Best-effort file write.
  }
  try {
    process.stderr.write(`[dp] ${line}\n`);
  } catch {
    // Best-effort stderr mirror.
  }
}

export function logError(src: string, err: unknown, extra: Record<string, unknown> = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  log("error", src, { ...extra, error: message, stack });
}

/**
 * Shared helpers and constants for session-id, plugin-root, and state-dir
 * propagation across both Claude Code and Cursor hooks.
 */

export const SESSION_ENV_VAR = "DP_SESSION_ID";
export const PLUGIN_ROOT_ENV_VAR = "DP_PLUGIN_ROOT";
export const STATE_DIR_ENV_VAR = "DP_STATE_DIR";
export const SESSION_FLAG = "--session";
export const UNOWNED_LABEL = "(unowned)";

export const CLAUDE_CODE_STATE_DIR = ".claude";
export const CURSOR_STATE_DIR = ".cursor";
export const DEFAULT_STATE_DIR = CLAUDE_CODE_STATE_DIR;

export function resolveStateDir(): string {
  const v = process.env[STATE_DIR_ENV_VAR];
  return v && v.length > 0 ? v : DEFAULT_STATE_DIR;
}

export function parseHookPayload(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readSessionIdFromPayload(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const id = (parsed as { session_id?: unknown }).session_id;
  return typeof id === "string" && id ? id : null;
}

export function resolveSessionIdFromEnv(): string | null {
  const v = process.env[SESSION_ENV_VAR];
  return v && v.length > 0 ? v : null;
}

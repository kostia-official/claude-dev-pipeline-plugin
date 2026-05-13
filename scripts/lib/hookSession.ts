/**
 * Shared helpers and constants for session-id propagation.
 *
 * - `readHookSessionId()` parses a Claude Code hook event JSON from stdin
 *   and returns the `session_id` field (or null on any malformed input).
 * - `resolveSessionIdFromEnv()` reads DP_SESSION_ID from the process env
 *   as a fallback for callers that aren't hooks.
 * - The string constants below replace ad-hoc literals across the plugin.
 */

export const SESSION_ENV_VAR = "DP_SESSION_ID";
export const SESSION_FLAG = "--session";
export const UNOWNED_LABEL = "(unowned)";

interface HookPayload {
  session_id?: string;
  transcript_path?: string;
}

export async function readHookSessionId(): Promise<string | null> {
  let raw = "";
  try {
    raw = await Bun.stdin.text();
  } catch {
    return null;
  }
  if (!raw.trim()) return null;
  try {
    const payload = JSON.parse(raw) as HookPayload;
    return typeof payload.session_id === "string" && payload.session_id ? payload.session_id : null;
  } catch {
    return null;
  }
}

export function resolveSessionIdFromEnv(): string | null {
  const v = process.env[SESSION_ENV_VAR];
  return v && v.length > 0 ? v : null;
}

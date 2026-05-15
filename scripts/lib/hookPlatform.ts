/**
 * Detect which harness invoked a hook by inspecting the stdin payload.
 *
 * Claude Code and Cursor both speak JSON over stdin/stdout, but their payload
 * shapes differ enough that one shared hook script can branch correctly:
 *
 *   Claude Code includes `transcript_path` and `hook_event_name` in PascalCase
 *   (e.g. "SessionStart").
 *
 *   Cursor includes `cursor_version`, `workspace_roots`, and `hook_event_name`
 *   in camelCase (e.g. "sessionStart").
 *
 * `detectPlatform` is intentionally lenient: when neither set of markers is
 * present (e.g. a unit-test fixture or an unfamiliar harness), it returns
 * "unknown" so the caller can exit silently instead of guessing.
 */

export type HookPlatform = "claude-code" | "cursor" | "unknown";

interface HookPayloadProbe {
  hook_event_name?: unknown;
  cursor_version?: unknown;
  workspace_roots?: unknown;
  transcript_path?: unknown;
}

function isPascalCase(name: string): boolean {
  const first = name.charAt(0);
  return first !== "" && first === first.toUpperCase() && first !== first.toLowerCase();
}

function isCamelCase(name: string): boolean {
  const first = name.charAt(0);
  return first !== "" && first === first.toLowerCase() && first !== first.toUpperCase();
}

export function detectPlatform(payload: unknown): HookPlatform {
  if (!payload || typeof payload !== "object") return "unknown";
  const probe = payload as HookPayloadProbe;

  const hasCursorMarkers =
    typeof probe.cursor_version === "string" || Array.isArray(probe.workspace_roots);
  if (hasCursorMarkers) return "cursor";

  const eventName = typeof probe.hook_event_name === "string" ? probe.hook_event_name : null;
  if (eventName && isCamelCase(eventName)) return "cursor";

  const hasClaudeMarkers = typeof probe.transcript_path === "string";
  if (hasClaudeMarkers) return "claude-code";

  if (eventName && isPascalCase(eventName)) return "claude-code";

  return "unknown";
}

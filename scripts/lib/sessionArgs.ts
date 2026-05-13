/**
 * Strip `--session <id>` from a positional-argument array. Returns the cleaned
 * positionals plus the extracted id. When the flag is absent, falls back to
 * DP_SESSION_ID from the process environment. Returns null when neither source
 * provides a value.
 */

import { SESSION_FLAG, resolveSessionIdFromEnv } from "./hookSession.ts";

export interface ExtractedSession {
  sessionId: string | null;
  rest: string[];
}

export function extractSessionFlag(positional: string[]): ExtractedSession {
  const rest: string[] = [];
  let sessionId: string | null = null;
  for (let i = 0; i < positional.length; i++) {
    const arg = positional[i];
    if (arg === SESSION_FLAG) {
      const next = positional[i + 1];
      if (next !== undefined) {
        sessionId = next;
        i++; // consume the value
      }
      continue;
    }
    if (arg !== undefined) rest.push(arg);
  }
  if (!sessionId) sessionId = resolveSessionIdFromEnv();
  return { sessionId, rest };
}

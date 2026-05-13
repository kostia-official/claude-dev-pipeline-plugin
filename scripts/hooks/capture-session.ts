#!/usr/bin/env bun
/**
 * SessionStart hook.
 *
 * Captures the current Claude Code session_id and exposes it via two channels
 * (deep-plan's belt-and-suspenders pattern):
 *
 *   1. Primary: hookSpecificOutput.additionalContext with DP_SESSION_ID=<id>,
 *      which Claude Code prepends to the conversation as a system reminder.
 *
 *   2. Secondary: append `export DP_SESSION_ID=<id>` to $CLAUDE_ENV_FILE if
 *      set, so bash subprocesses can read it as a fallback.
 *
 * Silently exits 0 on any error; failure must not break session start.
 */

import { readFileSync, appendFileSync } from "node:fs";
import { readHookSessionId, SESSION_ENV_VAR } from "../lib/hookSession.ts";

const sessionId = await readHookSessionId();
if (!sessionId) process.exit(0);

const output = {
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: `${SESSION_ENV_VAR}=${sessionId}`,
  },
};
console.log(JSON.stringify(output));

const envFile = process.env.CLAUDE_ENV_FILE;
if (envFile) {
  try {
    let existing = "";
    try {
      existing = readFileSync(envFile, "utf8");
    } catch (err) {
      // ENOENT is fine — file will be created on append. Re-throw anything else.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (!existing.includes(`${SESSION_ENV_VAR}=${sessionId}`)) {
      appendFileSync(envFile, `export ${SESSION_ENV_VAR}=${sessionId}\n`);
    }
  } catch {
    // Best-effort; the primary channel is enough.
  }
}

process.exit(0);

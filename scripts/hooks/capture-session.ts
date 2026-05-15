#!/usr/bin/env bun
/**
 * SessionStart hook for both Claude Code and Cursor.
 *
 * Captures the harness's session_id, the plugin's install root, and the
 * platform's state directory name, then exposes all three to the rest of
 * the session via the channel each platform understands:
 *
 *   - Claude Code: hookSpecificOutput.additionalContext + CLAUDE_ENV_FILE
 *     append (the deep-plan belt-and-suspenders pattern).
 *
 *   - Cursor: the sessionStart `env` field, which propagates to every
 *     subsequent hook in the session. additional_context mirrors the
 *     Claude Code system-reminder behavior.
 *
 * Silently exits 0 on any error; failure must not break session start.
 */

import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseHookPayload,
  readSessionIdFromPayload,
  CLAUDE_CODE_STATE_DIR,
  CURSOR_STATE_DIR,
  PLUGIN_ROOT_ENV_VAR,
  SESSION_ENV_VAR,
  STATE_DIR_ENV_VAR,
} from "../lib/hookSession.ts";
import { detectPlatform } from "../lib/hookPlatform.ts";
import { log, logError } from "../lib/logger.ts";

process.on("uncaughtException", (err) => {
  logError("capture-session", err);
  process.exit(0);
});

const stdinRaw = await Bun.stdin.text();
const payload = parseHookPayload(stdinRaw);
const sessionId = readSessionIdFromPayload(payload);
if (!sessionId) {
  log("info", "capture-session", { event: "no-session-id-skipped" });
  process.exit(0);
}

const pluginRoot = resolve(import.meta.dir, "..", "..");
const platform = detectPlatform(payload);
const stateDir = platform === "cursor" ? CURSOR_STATE_DIR : CLAUDE_CODE_STATE_DIR;
const contextBlock = [
  `${SESSION_ENV_VAR}=${sessionId}`,
  `${PLUGIN_ROOT_ENV_VAR}=${pluginRoot}`,
  `${STATE_DIR_ENV_VAR}=${stateDir}`,
].join("\n");

log("info", "capture-session", { platform, sessionId, pluginRoot, stateDir });

if (platform === "cursor") {
  const output = {
    env: {
      [SESSION_ENV_VAR]: sessionId,
      [PLUGIN_ROOT_ENV_VAR]: pluginRoot,
      [STATE_DIR_ENV_VAR]: stateDir,
    },
    additional_context: contextBlock,
  };
  console.log(JSON.stringify(output));
  process.exit(0);
}

const claudeOutput = {
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: contextBlock,
  },
};
console.log(JSON.stringify(claudeOutput));

const envFile = process.env.CLAUDE_ENV_FILE;
if (envFile) {
  try {
    let existing = "";
    try {
      existing = readFileSync(envFile, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const lines: Array<[string, string]> = [
      [SESSION_ENV_VAR, sessionId],
      [PLUGIN_ROOT_ENV_VAR, pluginRoot],
      [STATE_DIR_ENV_VAR, stateDir],
    ];
    let appended = "";
    for (const [name, value] of lines) {
      if (!existing.includes(`${name}=${value}`)) {
        appended += `export ${name}=${value}\n`;
      }
    }
    if (appended) appendFileSync(envFile, appended);
  } catch {
    // Best-effort; the primary channel is enough.
  }
}

process.exit(0);

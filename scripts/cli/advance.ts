#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { logError, logsPathForCwd, LOGS_DIR } from "../lib/logger.ts";
import {
  buildInitialState,
  formatStateSummary,
  getByPath,
  nextStep,
  readState,
  setByPath,
  STEP_ORDER,
  writeState,
  type PipelineState,
  type StepName,
} from "../lib/state.ts";
import { extractSessionFlag } from "../lib/sessionArgs.ts";
import { resolveSessionIdFromEnv, resolveStateDir } from "../lib/hookSession.ts";

process.on("uncaughtException", (err) => {
  logError(`advance${process.argv[2] ? `.${process.argv[2]}` : ""}`, err, {
    argv: process.argv.slice(2),
  });
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});

function usage(): never {
  console.error(
    `Usage:
  advance.ts init <slug> "<args>" [<session-id>]
  advance.ts get <slug-or-run-dir> <dotted.path>
  advance.ts set <slug-or-run-dir> <dotted.path> <json-value> [--session <id>]
  advance.ts advance <slug-or-run-dir> <step-name> [--session <id>]
  advance.ts status <slug-or-run-dir>
  advance.ts abort <slug-or-run-dir> [--session <id>]
  advance.ts runpath <slug>
  advance.ts exists <slug-or-run-dir>
  advance.ts logs

Resolution:
  - A slug (no slash) is resolved to <cwd>/$DP_STATE_DIR/feature-pipeline/<slug>/.
    DP_STATE_DIR defaults to ".claude" if unset.
  - An absolute path, "~"-prefixed path, or path containing "/" is used verbatim.
  - 'init' creates the resolved directory if it doesn't exist.
  - 'runpath' prints the project-relative path (e.g. ".cursor/feature-pipeline/foo").
  - 'exists' always exits 0; prints {"exists": false} or {"exists": true, "active": <bool>, ...}.
  - 'logs' prints the path to today's log file (${LOGS_DIR}/<YYYY-MM-DD>.ndjson).

Session:
  - When --session is omitted, the effective id falls back to process.env.DP_SESSION_ID.
    When both are absent, no tag-on-touch occurs.
  - Tag-on-touch: 'set', 'advance', 'abort' stamp state.sessionId if missing.`,
  );
  process.exit(2);
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isStepName(s: string): s is StepName {
  return (STEP_ORDER as readonly string[]).includes(s);
}

function looksLikePath(input: string): boolean {
  return input.includes("/") || input.startsWith("~");
}

function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

function resolveRunDir(slugOrPath: string): string {
  if (looksLikePath(slugOrPath)) {
    const expanded = expandHome(slugOrPath);
    return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
  }
  return join(process.cwd(), resolveStateDir(), "feature-pipeline", slugOrPath);
}

function relativeRunPath(slug: string): string {
  return join(resolveStateDir(), "feature-pipeline", slug);
}

function applyTagOnTouch(state: PipelineState, sessionId: string | null): void {
  if (!sessionId) return;
  if (state.sessionId) return;
  state.sessionId = sessionId;
}

const [, , subcommand, ...rest] = process.argv;
if (!subcommand) usage();

switch (subcommand) {
  case "init": {
    const [slug, args, sessionIdArg] = rest;
    if (!slug || args === undefined) usage();
    const explicit = sessionIdArg && sessionIdArg.length > 0 ? sessionIdArg : null;
    const effectiveSessionId = explicit ?? resolveSessionIdFromEnv();
    const runDir = resolveRunDir(slug);
    await mkdir(runDir, { recursive: true });
    const state = buildInitialState(slug, args, effectiveSessionId ?? undefined);
    await writeState(runDir, state);
    console.log(
      JSON.stringify({
        ok: true,
        runDir,
        relativePath: relativeRunPath(slug),
        name: slug,
        sessionId: state.sessionId ?? null,
      }),
    );
    break;
  }
  case "get": {
    const [slugOrPath, path] = rest;
    if (!slugOrPath || !path) usage();
    const state = await readState(resolveRunDir(slugOrPath));
    const value = getByPath(state, path);
    console.log(typeof value === "string" ? value : JSON.stringify(value));
    break;
  }
  case "set": {
    const { sessionId, rest: positional } = extractSessionFlag(rest);
    const [slugOrPath, path, raw] = positional;
    if (!slugOrPath || !path || raw === undefined) usage();
    const runDir = resolveRunDir(slugOrPath);
    const state = await readState(runDir);
    applyTagOnTouch(state, sessionId);
    setByPath(state as unknown as Record<string, unknown>, path, parseJsonValue(raw));
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true, sessionId: state.sessionId ?? null }));
    break;
  }
  case "advance": {
    const { sessionId, rest: positional } = extractSessionFlag(rest);
    const [slugOrPath, stepName] = positional;
    if (!slugOrPath || !stepName) usage();
    if (!isStepName(stepName)) {
      console.error(`Unknown step: ${stepName}`);
      process.exit(2);
    }
    const runDir = resolveRunDir(slugOrPath);
    const state = await readState(runDir);
    applyTagOnTouch(state, sessionId);
    const step = state.steps[stepName];
    step.status = "done";
    step.completedAt = new Date().toISOString();
    const next = nextStep(stepName);
    state.currentStep = next;
    if (next === "done") state.active = false;
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true, advancedTo: next, sessionId: state.sessionId ?? null }));
    break;
  }
  case "status": {
    const [slugOrPath] = rest;
    if (!slugOrPath) usage();
    const state = await readState(resolveRunDir(slugOrPath));
    console.log(formatStateSummary(state));
    break;
  }
  case "abort": {
    const { sessionId, rest: positional } = extractSessionFlag(rest);
    const [slugOrPath] = positional;
    if (!slugOrPath) usage();
    const runDir = resolveRunDir(slugOrPath);
    const state = await readState(runDir);
    applyTagOnTouch(state, sessionId);
    state.active = false;
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true, aborted: state.name, sessionId: state.sessionId ?? null }));
    break;
  }
  case "runpath": {
    const [slug] = rest;
    if (!slug) usage();
    console.log(relativeRunPath(slug));
    break;
  }
  case "exists": {
    const [slugOrPath] = rest;
    if (!slugOrPath) usage();
    const runDir = resolveRunDir(slugOrPath);
    const stateFile = join(runDir, "state.json");
    if (!existsSync(stateFile)) {
      console.log(JSON.stringify({ exists: false, runDir }));
      break;
    }
    const state = await readState(runDir);
    console.log(
      JSON.stringify({
        exists: true,
        runDir,
        active: state.active,
        currentStep: state.currentStep,
        sessionId: state.sessionId ?? null,
      }),
    );
    break;
  }
  case "logs": {
    console.log(logsPathForCwd());
    break;
  }
  default:
    usage();
}

#!/usr/bin/env bun
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
import { resolveSessionIdFromEnv } from "../lib/hookSession.ts";

function usage(): never {
  console.error(
    `Usage:
  advance.ts init <run-dir> <slug> "<args>" [<session-id>]
  advance.ts get <run-dir> <dotted.path>
  advance.ts set <run-dir> <dotted.path> <json-value> [--session <id>]
  advance.ts advance <run-dir> <step-name> [--session <id>]
  advance.ts status <run-dir>
  advance.ts abort <run-dir> [--session <id>]

Notes:
  - When --session is omitted, the effective session id falls back to
    process.env.DP_SESSION_ID. When both are absent, no tag-on-touch occurs.
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

// If state has no sessionId and we have a current id, stamp it.
function applyTagOnTouch(state: PipelineState, sessionId: string | null): void {
  if (!sessionId) return;
  if (state.sessionId) return;
  state.sessionId = sessionId;
}

const [, , subcommand, ...rest] = process.argv;
if (!subcommand) usage();

switch (subcommand) {
  case "init": {
    const [runDir, slug, args, sessionIdArg] = rest;
    if (!runDir || !slug || args === undefined) usage();
    const explicit = sessionIdArg && sessionIdArg.length > 0 ? sessionIdArg : null;
    const effectiveSessionId = explicit ?? resolveSessionIdFromEnv();
    const state = buildInitialState(slug, args, effectiveSessionId ?? undefined);
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true, runDir, name: slug, sessionId: state.sessionId ?? null }));
    break;
  }
  case "get": {
    const [runDir, path] = rest;
    if (!runDir || !path) usage();
    const state = await readState(runDir);
    const value = getByPath(state, path);
    console.log(typeof value === "string" ? value : JSON.stringify(value));
    break;
  }
  case "set": {
    const { sessionId, rest: positional } = extractSessionFlag(rest);
    const [runDir, path, raw] = positional;
    if (!runDir || !path || raw === undefined) usage();
    const state = await readState(runDir);
    applyTagOnTouch(state, sessionId);
    setByPath(state as unknown as Record<string, unknown>, path, parseJsonValue(raw));
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true, sessionId: state.sessionId ?? null }));
    break;
  }
  case "advance": {
    const { sessionId, rest: positional } = extractSessionFlag(rest);
    const [runDir, stepName] = positional;
    if (!runDir || !stepName) usage();
    if (!isStepName(stepName)) {
      console.error(`Unknown step: ${stepName}`);
      process.exit(2);
    }
    const state = await readState(runDir);
    applyTagOnTouch(state, sessionId);
    const step = state.steps[stepName];
    step.status = "done";
    step.completedAt = new Date().toISOString();
    const next = nextStep(stepName);
    state.currentStep = next;
    // Leave next step's status as "pending" — the Stop hook treats `pending`
    // on the current step as "must invoke /dp:<step> now". Each skill's body
    // sets its own status to "running" in step 1.
    if (next === "done") state.active = false;
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true, advancedTo: next, sessionId: state.sessionId ?? null }));
    break;
  }
  case "status": {
    const [runDir] = rest;
    if (!runDir) usage();
    const state = await readState(runDir);
    console.log(formatStateSummary(state));
    break;
  }
  case "abort": {
    const { sessionId, rest: positional } = extractSessionFlag(rest);
    const [runDir] = positional;
    if (!runDir) usage();
    const state = await readState(runDir);
    applyTagOnTouch(state, sessionId);
    state.active = false;
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true, aborted: state.name, sessionId: state.sessionId ?? null }));
    break;
  }
  default:
    usage();
}

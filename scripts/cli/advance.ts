#!/usr/bin/env bun
import {
  buildInitialState,
  getByPath,
  nextStep,
  readState,
  setByPath,
  STEP_ORDER,
  writeState,
  type PipelineState,
  type StepName,
} from "../lib/state.ts";

function usage(): never {
  console.error(
    `Usage:
  advance.ts init <run-dir> <slug> "<args>"
  advance.ts get <run-dir> <dotted.path>
  advance.ts set <run-dir> <dotted.path> <json-value>
  advance.ts advance <run-dir> <step-name>
  advance.ts status <run-dir>
  advance.ts abort <run-dir>`,
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

const [, , subcommand, ...rest] = process.argv;
if (!subcommand) usage();

switch (subcommand) {
  case "init": {
    const [runDir, slug, args] = rest;
    if (!runDir || !slug || args === undefined) usage();
    const state = buildInitialState(slug, args);
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true, runDir, name: slug }));
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
    const [runDir, path, raw] = rest;
    if (!runDir || !path || raw === undefined) usage();
    const state = await readState(runDir);
    setByPath(state as unknown as Record<string, unknown>, path, parseJsonValue(raw));
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true }));
    break;
  }
  case "advance": {
    const [runDir, stepName] = rest;
    if (!runDir || !stepName) usage();
    if (!isStepName(stepName)) {
      console.error(`Unknown step: ${stepName}`);
      process.exit(2);
    }
    const state = await readState(runDir);
    const step = state.steps[stepName];
    step.status = "done";
    step.completedAt = new Date().toISOString();
    const next = nextStep(stepName);
    state.currentStep = next;
    // Intentionally leave next step's status as "pending" — the
    // pipeline-progress hook treats `pending` on the current step as
    // "must invoke /dp:<step> now". Each skill's body sets its own
    // status to "running" in step 1.
    if (next === "done") state.active = false;
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true, advancedTo: next }));
    break;
  }
  case "status": {
    const [runDir] = rest;
    if (!runDir) usage();
    const state = await readState(runDir);
    printStatus(state);
    break;
  }
  case "abort": {
    const [runDir] = rest;
    if (!runDir) usage();
    const state = await readState(runDir);
    state.active = false;
    await writeState(runDir, state);
    console.log(JSON.stringify({ ok: true, aborted: state.name }));
    break;
  }
  default:
    usage();
}

function printStatus(state: PipelineState): void {
  const lines: string[] = [];
  lines.push(`Pipeline: ${state.name}`);
  lines.push(`Active:   ${state.active}`);
  lines.push(`Auto:     ${state.autonomous}`);
  lines.push(`Current:  ${state.currentStep}`);
  lines.push("");
  lines.push("Steps:");
  for (const step of STEP_ORDER) {
    const s = state.steps[step];
    const marker = s.status === "done" ? "✓" : s.status === "running" ? "▶" : s.status === "failed" ? "✗" : "·";
    lines.push(`  ${marker} ${step.padEnd(20)} ${s.status}${s.artifact ? `  (${s.artifact})` : ""}`);
  }
  console.log(lines.join("\n"));
}

#!/usr/bin/env bun
/**
 * Plugin-wide Stop hook for both Claude Code and Cursor. Enforces pipeline
 * progression for the CURRENT session.
 *
 * Order matters: read session_id from stdin BEFORE calling findActiveRun,
 * otherwise the filter is silently a no-op.
 *
 * Output differs by platform:
 *   - Claude Code accepts `{decision: "block", reason}` as a hard gate.
 *   - Cursor accepts `{followup_message}` which auto-submits as the next
 *     user turn. The model can ignore it, but the auto-prompt still nudges
 *     the pipeline forward.
 */

import { findActiveRun } from "../lib/findRun.ts";
import {
  parseHookPayload,
  readSessionIdFromPayload,
  resolveSessionIdFromEnv,
} from "../lib/hookSession.ts";
import { detectPlatform, type HookPlatform } from "../lib/hookPlatform.ts";
import { log, logError } from "../lib/logger.ts";

process.on("uncaughtException", (err) => {
  logError("enforce-pipeline-progress", err);
  process.exit(0);
});

interface NextStepGate {
  platform: HookPlatform;
  stepName: string;
  runDir: string;
  runName: string;
}

interface ChecksPassedGate {
  platform: HookPlatform;
  runDir: string;
}

const stdinRaw = await Bun.stdin.text();
const payload = parseHookPayload(stdinRaw);
const sessionId = readSessionIdFromPayload(payload) ?? resolveSessionIdFromEnv();
const platform = detectPlatform(payload);

const run = await findActiveRun(process.cwd(), sessionId);
if (!run) {
  log("info", "enforce-pipeline-progress", { platform, sessionId, result: "no-active-run" });
  process.exit(0);
}

const { runDir, state } = run;
if (!state.active) {
  log("info", "enforce-pipeline-progress", { platform, runDir, result: "run-inactive" });
  process.exit(0);
}
if (state.currentStep === "done") {
  log("info", "enforce-pipeline-progress", { platform, runDir, result: "pipeline-done" });
  process.exit(0);
}

const stepName = state.currentStep;
const step = state.steps[stepName];

if (step.status === "pending") {
  log("info", "enforce-pipeline-progress", { platform, runDir, gate: "pending-step", stepName });
  emitNextStepGate({ platform, stepName, runDir, runName: state.name });
  process.exit(0);
}

if (stepName === "implementation" && step.checksPassed !== true) {
  log("info", "enforce-pipeline-progress", { platform, runDir, gate: "checks-not-passed" });
  emitChecksPassedGate({ platform, runDir });
  process.exit(0);
}

log("info", "enforce-pipeline-progress", { platform, runDir, result: "no-gate-needed", stepName });
process.exit(0);

function emitNextStepGate(gate: NextStepGate): void {
  if (gate.platform === "cursor") {
    const followup = `Continue dp pipeline: invoke /${gate.stepName} now.`;
    console.log(JSON.stringify({ followup_message: followup }));
    return;
  }
  const reason = [
    `dp pipeline run "${gate.runName}" is at step "${gate.stepName}" but its status is "pending".`,
    `That means /dp:dev-pipeline (or the previous skill) finished without actually invoking the next skill.`,
    ``,
    `You MUST invoke the matching skill NOW via the Skill tool:`,
    `  Skill(skill_name = "dp:${gate.stepName}")`,
    ``,
    `Do not end your turn with text alone. The pipeline only progresses when the next skill is actually invoked.`,
    `Run dir: ${gate.runDir}`,
  ].join("\n");
  console.log(JSON.stringify({ decision: "block", reason }));
}

function emitChecksPassedGate(gate: ChecksPassedGate): void {
  const sharedLines = [
    `dp:implementation has not recorded a successful typecheck + lint pass.`,
    `Run the project's typecheck and lint, fix any errors, then mark the gate:`,
    `  bun \${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set ${gate.runDir} steps.implementation.checksPassed true`,
  ];
  if (gate.platform === "cursor") {
    console.log(JSON.stringify({ followup_message: sharedLines.join("\n") }));
    return;
  }
  const reason = [...sharedLines, `Only after that should the implementation step finish.`].join("\n");
  console.log(JSON.stringify({ decision: "block", reason }));
}

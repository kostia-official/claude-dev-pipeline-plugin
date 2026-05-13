#!/usr/bin/env bun
/**
 * Plugin-wide Stop hook. Enforces pipeline progression for the CURRENT session.
 *
 * Order matters: read session_id from stdin BEFORE calling findActiveRun,
 * otherwise the filter is silently a no-op.
 *
 * Block checks (once a session-owned active run is found):
 *   A. steps[currentStep].status === "pending"   → orchestrator/chain didn't
 *      hand off; force Skill invocation.
 *   B. currentStep === "implementation" and !checksPassed → typecheck/lint
 *      hasn't been recorded; force the gate.
 */

import { findActiveRun } from "../lib/findRun.ts";
import { readHookSessionId, resolveSessionIdFromEnv } from "../lib/hookSession.ts";

const sessionId = (await readHookSessionId()) ?? resolveSessionIdFromEnv();

const run = await findActiveRun(process.cwd(), sessionId);
if (!run) process.exit(0);

const { runDir, state } = run;
if (!state.active) process.exit(0);
if (state.currentStep === "done") process.exit(0);

const stepName = state.currentStep;
const step = state.steps[stepName];

if (step.status === "pending") {
  const reason = [
    `dp pipeline run "${state.name}" is at step "${stepName}" but its status is "pending".`,
    `That means /dp:dev-pipeline (or the previous skill) finished without actually invoking the next skill.`,
    ``,
    `You MUST invoke the matching skill NOW via the Skill tool:`,
    `  Skill(skill_name = "dp:${stepName}")`,
    ``,
    `Do not end your turn with text alone. The pipeline only progresses when the next skill is actually invoked.`,
    `Run dir: ${runDir}`,
  ].join("\n");
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

if (stepName === "implementation" && step.checksPassed !== true) {
  const reason = [
    `dp:implementation has not recorded a successful typecheck + lint pass.`,
    `Run the project's typecheck and lint, fix any errors, then mark the gate:`,
    `  bun \${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set ${runDir} steps.implementation.checksPassed true`,
    `Only after that should the implementation step finish.`,
  ].join("\n");
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

process.exit(0);

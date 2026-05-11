#!/usr/bin/env bun
/**
 * Plugin-wide Stop hook.
 *
 * Enforces pipeline progression so the orchestrator and skills cannot text-stop
 * mid-pipeline. Two checks, in order:
 *
 *   1. If `state.steps[currentStep].status === "pending"`, the orchestrator (or
 *      the previous skill) finished its turn without actually invoking the next
 *      skill. BLOCK with a clear instruction to invoke /dp:<currentStep>.
 *
 *   2. If `currentStep === "implementation"` and `steps.implementation.checksPassed !== true`,
 *      typecheck + lint haven't been recorded as passing. BLOCK.
 *
 * Inert outside an active pipeline run (no run dir → exit 0).
 */

import { findActiveRun } from "../lib/findRun.ts";

// drain stdin so the hook framework doesn't complain
await Bun.stdin.text().catch(() => "");

const cwd = process.cwd();
const run = await findActiveRun(cwd);
if (!run) process.exit(0);

const { runDir, state } = run;
if (!state.active) process.exit(0);
if (state.currentStep === "done") process.exit(0);

const stepName = state.currentStep;
const step = state.steps[stepName];

// Check 1: orchestrator / chain hand-off failed.
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

// Check 2: implementation checks must have passed.
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

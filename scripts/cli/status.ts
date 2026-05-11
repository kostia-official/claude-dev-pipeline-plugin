#!/usr/bin/env bun
import { findActiveRun } from "../lib/findRun.ts";
import { STEP_ORDER, type PipelineState } from "../lib/state.ts";

const startDir = process.argv[2] ?? process.cwd();
const run = await findActiveRun(startDir);

if (!run) {
  console.log("No active dev-pipeline run found.");
  process.exit(0);
}

print(run.runDir, run.state);

function print(runDir: string, state: PipelineState): void {
  const lines: string[] = [];
  lines.push(`Pipeline: ${state.name}`);
  lines.push(`Dir:      ${runDir}`);
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

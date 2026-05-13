#!/usr/bin/env bun
import { findActiveRun } from "../lib/findRun.ts";
import { formatStateSummary } from "../lib/state.ts";
import { extractSessionFlag } from "../lib/sessionArgs.ts";

const { sessionId, rest } = extractSessionFlag(process.argv.slice(2));
const startDir = rest[0] ?? process.cwd();
const run = await findActiveRun(startDir, sessionId);

if (!run) {
  console.log("No active dev-pipeline run found.");
  process.exit(0);
}

console.log(formatStateSummary(run.state, run.runDir));

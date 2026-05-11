import { join, dirname, resolve } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readState, type PipelineState } from "./state.ts";

export interface ActiveRun {
  runDir: string;
  state: PipelineState;
}

export function findFeaturePipelineDir(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".claude", "feature-pipeline");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function findActiveRun(startDir: string): Promise<ActiveRun | null> {
  const fpDir = findFeaturePipelineDir(startDir);
  if (!fpDir) return null;
  const entries = readdirSync(fpDir, { withFileTypes: true });
  const active: ActiveRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runDir = join(fpDir, entry.name);
    const stateFile = join(runDir, "state.json");
    if (!existsSync(stateFile)) continue;
    try {
      const state = await readState(runDir);
      if (state.active) active.push({ runDir, state });
    } catch {
      continue;
    }
  }
  if (active.length === 0) return null;
  if (active.length === 1) {
    const only = active[0];
    return only ?? null;
  }
  active.sort((a, b) => {
    const aT = a.state.updatedAt ?? a.state.createdAt;
    const bT = b.state.updatedAt ?? b.state.createdAt;
    return bT.localeCompare(aT);
  });
  return active[0] ?? null;
}

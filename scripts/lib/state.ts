import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { UNOWNED_LABEL } from "./hookSession.ts";

export const STEP_ORDER = [
  "investigation",
  "plan-proposal",
  "plan",
  "plan-improve",
  "plan-improve-apply",
  "plan-wrapup",
  "implementation",
  "codereview",
] as const;

export type StepName = (typeof STEP_ORDER)[number];
export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface StepState {
  status: StepStatus;
  artifact?: string;
  startedAt?: string;
  completedAt?: string;
  approvedAt?: string;
  approvalMode?: "yes" | "yes-autonomous" | "no";
  checksPassed?: boolean;
  [key: string]: unknown;
}

export interface PipelineState {
  name: string;
  createdAt: string;
  updatedAt?: string;
  active: boolean;
  autonomous: boolean;
  currentStep: StepName | "done";
  steps: Record<StepName, StepState>;
  args: string;
  // Identifies the Claude Code session that owns this run. Absence = legacy
  // run created before session scoping; eligible for tag-on-touch adoption.
  sessionId?: string;
}

export function statePath(runDir: string): string {
  return join(resolve(runDir), "state.json");
}

export async function readState(runDir: string): Promise<PipelineState> {
  const path = statePath(runDir);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`No state.json at ${path}`);
  }
  return (await file.json()) as PipelineState;
}

export async function writeState(runDir: string, state: PipelineState): Promise<void> {
  const path = statePath(runDir);
  const dir = resolve(runDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  state.updatedAt = new Date().toISOString();
  await Bun.write(path, JSON.stringify(state, null, 2) + "\n");
}

export function buildInitialState(slug: string, args: string, sessionId?: string): PipelineState {
  const now = new Date().toISOString();
  const steps = STEP_ORDER.reduce(
    (acc, step) => {
      acc[step] = { status: "pending" };
      return acc;
    },
    {} as Record<StepName, StepState>,
  );
  const state: PipelineState = {
    name: slug,
    createdAt: now,
    updatedAt: now,
    active: true,
    autonomous: false,
    currentStep: "investigation",
    steps,
    args,
  };
  if (sessionId) state.sessionId = sessionId;
  return state;
}

export function nextStep(step: StepName): StepName | "done" {
  const idx = STEP_ORDER.indexOf(step);
  if (idx === -1 || idx === STEP_ORDER.length - 1) return "done";
  const next = STEP_ORDER[idx + 1];
  if (!next) return "done";
  return next;
}

export function getByPath(obj: unknown, dotted: string): unknown {
  const parts = dotted.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function formatStateSummary(state: PipelineState, runDir?: string): string {
  const lines: string[] = [];
  lines.push(`Pipeline: ${state.name}`);
  if (runDir) lines.push(`Dir:      ${runDir}`);
  lines.push(`Active:   ${state.active}`);
  lines.push(`Auto:     ${state.autonomous}`);
  lines.push(`Session:  ${state.sessionId ?? UNOWNED_LABEL}`);
  lines.push(`Current:  ${state.currentStep}`);
  lines.push("");
  lines.push("Steps:");
  for (const step of STEP_ORDER) {
    const s = state.steps[step];
    const marker = s.status === "done" ? "✓" : s.status === "running" ? "▶" : s.status === "failed" ? "✗" : "·";
    lines.push(`  ${marker} ${step.padEnd(20)} ${s.status}${s.artifact ? `  (${s.artifact})` : ""}`);
  }
  return lines.join("\n");
}

export function setByPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  const last = parts.pop();
  if (!last) throw new Error(`Empty path: ${dotted}`);
  let cur: Record<string, unknown> = obj;
  for (const part of parts) {
    const child = cur[part];
    if (child === null || typeof child !== "object" || Array.isArray(child)) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  cur[last] = value;
}

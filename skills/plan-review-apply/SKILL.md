---
name: plan-review-apply
description: Use when an active dev-pipeline run is at the plan-review-apply step. Walks plan-review.md findings one-by-one as todos, reasons about each fix in isolation, asks the user with concrete options when direction is unclear, and patches plan.md. Self-contained.
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash(bun *)
  - TodoWrite
  - AskUserQuestion
---

# dp:plan-review-apply

Apply review findings to `plan.md`, one finding at a time. The findings in `plan-review.md` are **already adversarially verified** by `dp:plan-review` (CONFIRMED or PLAUSIBLE) — this step does not re-litigate whether they are real; it decides the fix and patches the plan.

## Inputs

- `RUN_DIR` — run directory.
- `<RUN_DIR>/plan-review.md` — verified findings from `dp:plan-review`.
- `<RUN_DIR>/plan.md` — target file to patch.
- `<RUN_DIR>/state.json` — for the `autonomous` flag.

If `plan-review.md` says `No issues found.`, skip to step 5 (advance) and hand off.

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-review-apply.status running --session "<DP_SESSION_ID>"
```

### 2. One todo per finding — think separately per todo

> Create a todo for each finding in `plan-review.md`, plus one final todo: "Check plan consistency". Work each todo **one by one**: read that single finding, reason about **its** fix in isolation, ask an interactive question with proper explanation if direction is unclear, patch `plan.md`, then move to the next todo.

**Reason about each fix independently — never draft one batched fix for all findings at once.** Each finding gets its own focused decision and its own edit.

- Read findings from `<RUN_DIR>/plan-review.md`.
- Use `TodoWrite` to create one todo per finding + a final "Check plan consistency" todo.
- Patch `<RUN_DIR>/plan.md` in place, one finding at a time.
- "auto" mode is determined by `state.json.autonomous` — read it once and apply throughout. If `autonomous === true`, decide everything yourself; never ask.

### 3. CONFIRMED vs PLAUSIBLE

Findings are tagged `[CONFIRMED · …]` or `[PLAUSIBLE · …]`.

- **CONFIRMED** — apply the fix. Editing plan text is cheap and reversible, so there is no reason to leave a confirmed plan defect in place.
- **PLAUSIBLE** — apply if the fix is clearly an improvement; otherwise (autonomous off) surface it with `AskUserQuestion` and let the user decide. Do not silently drop a PLAUSIBLE finding.

### 4. Options instead of open prompts

When a fix direction is **unclear** and `autonomous === false`:

- Use `AskUserQuestion` with **concrete options** (not an open-ended prompt). Always include an explicit "**Decide for me**" option as the last choice — it falls back to your best-guess fix and proceeds.
- We want the user to point at A or B, not to type an essay.

When a fix direction is **clear** (the finding's suggested fix is unambiguous, or autonomous mode), just patch and move on.

### 5. Final todo — consistency check

Re-read the entire `plan.md`. Look for contradictions between sections that may have appeared after multiple patches (e.g. approach says "use existing X", file-by-file now uses Y). Fix any you find. Update the file in place.

### 6. Mark done and advance

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> plan-review-apply --session "<DP_SESSION_ID>"
```

### 7. Hand off to `dp:plan-wrapup` — do not text-stop

The plugin's Stop hook gates progression on Claude Code (hard block while `steps.plan-wrapup.status === "pending"`) and auto-prompts the next skill on Cursor (soft auto-submit). Either way, advancing state.json correctly is mandatory.

Print a one-liner first, referencing the patched `plan.md` as a **markdown link**:

```
Review fixes applied — open [plan.md](${DP_STATE_DIR}/feature-pipeline/<feature>/plan.md). Finalizing now.
```

**On Claude Code**: your very next action MUST be a Skill-tool invocation in this same turn:

```
Skill(skill_name = "dp:plan-wrapup")
```

**On Cursor**: there is no Skill tool — end your turn after the one-liner above. The plugin's `stop` hook will auto-submit `/plan-wrapup` as a follow-up turn, triggering the next skill via slash-prefix auto-discovery.

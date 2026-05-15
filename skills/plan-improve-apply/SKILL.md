---
name: plan-improve-apply
description: Use when an active dev-pipeline run is at the plan-improve-apply step. Walks through review.md issues one-by-one as todos, asks the user with concrete options when fix direction is unclear, and patches plan.md. Self-contained — embeds the original /plan-improve-apply discipline plus dp-specific options-style questions.
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash(bun *)
  - TodoWrite
  - AskUserQuestion
---

# dp:plan-improve-apply

Apply review fixes to `plan.md`. **Self-contained**: embeds the original `/plan-improve-apply` discipline verbatim, then extends with dp-specific rules. Does NOT invoke `/plan-improve-apply`.

## Inputs

- `RUN_DIR` — run directory.
- `<RUN_DIR>/review.md` — issues from `dp:plan-improve`.
- `<RUN_DIR>/plan.md` — target file to patch.
- `<RUN_DIR>/state.json` — for `autonomous` flag.

If `review.md` says `No issues found.`, skip to step 5 (advance) and hand off.

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-improve-apply.status running --session "<DP_SESSION_ID>"
```

### 2. Original `/plan-improve-apply` discipline (verbatim — follow exactly)

> Create a todo for each issue found in review, and one final todo: "Check plan consistency". Work on each todo one by one, think about the issue, ask interactive question(s) with proper explanation if needed, update the plan, then proceed to next todo.
>
> For final "Check plan consistency", read the full plan and understand if small plan patches that were done correlate with each other and no conflicts.
>
> No questions, decide all yourself if initial prompt contains "auto".

For dp:

- Read issues from `<RUN_DIR>/review.md`.
- Use `TodoWrite` to create one todo per issue + a final "Check plan consistency" todo.
- Work each todo one by one, patching `<RUN_DIR>/plan.md` in place.
- "auto" mode is determined by `state.json.autonomous` — read it once and apply throughout. If `autonomous === true`, decide everything yourself; never ask.

### 3. dp-specific extension — options instead of open prompts

When a fix direction for an issue is **unclear** and `autonomous === false`:

- Use `AskUserQuestion` with **concrete options** (not an open-ended prompt). Always include an explicit "**Decide for me**" option as the last choice — it falls back to your best-guess fix and proceeds.
- The original "ask interactive question(s) with proper explanation if needed" rule still applies, but always in the structured-options form. We want the user to point at A or B, not to type an essay.

When a fix direction is **clear** (the review tells you exactly what to do, or autonomous mode), just patch and move on.

### 4. Final todo — consistency check

Re-read the entire `plan.md`. Look for contradictions between sections that may have appeared after multiple patches. Fix any you find. Update file in place.

### 5. Mark done and advance

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> plan-improve-apply --session "<DP_SESSION_ID>"
```

### 6. Hand off to `dp:plan-wrapup` — do not text-stop

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

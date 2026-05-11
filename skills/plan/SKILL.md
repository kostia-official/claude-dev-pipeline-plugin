---
name: plan
description: Use when an active dev-pipeline run is at the plan step. Writes a detailed plan.md (Context, Approach, File-by-file changes, Reuse & extraction, Verification) following Claude Code's built-in plan-mode discipline.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash(bun *)
  - AskUserQuestion
---

# dp:plan

Write a detailed plan document. The proposal is already approved; now produce a plan that an engineer (or another Claude session) can execute without further clarification.

## Inputs

- `RUN_DIR` — run directory.
- `<RUN_DIR>/context.md` — investigation output (read in full).
- `<RUN_DIR>/state.json` — for `args`, `autonomous` flag, and what the proposal already approved.

## Procedure

### 1. Mark running

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan.status running
```

### 2. Apply built-in plan-mode discipline

Same rules Claude Code uses in regular plan mode:

- Begin with a **Context** section explaining why this change is being made.
- Include only the recommended approach, not alternatives.
- Concise enough to scan quickly, detailed enough to execute.
- Reference critical files with absolute paths.
- Reference existing functions/utilities to be reused, with paths.
- Include a verification section describing end-to-end testing.

You **may** ask interactive `AskUserQuestion` questions for genuinely unclear details. **Skip asking entirely if `state.autonomous === true`** — make the best decision and document it as a "decided" note in the plan.

### 2.5. No shortcuts — write the thorough plan

When you have two plausible plans — a quick-and-dirty patch versus a slower fix that also tidies related code, removes duplication, or extends a small refactor — **always write the thorough one**. Not the lazy one. Not "the minimal diff".

Rationale: the user will reject a shortcut plan and ask for the proper one. Writing the shortcut wastes a full review/improve/apply cycle. The plan should include:

- Removing duplication the change exposes.
- Extracting one-time-used code into a shared place if a second caller now needs it (this should already appear in the "Reuse & extraction" section below — make sure it's concrete).
- Updating ALL call sites consistently rather than patching one and leaving divergent shapes elsewhere.
- Cleaning up adjacent code that the change touches.

If the proposal explicitly opted for a minimal-diff approach (the user typed "just patch this one place" or similar, captured in section 1 of the approved proposal), follow that — but note in the plan's Context section that the scope is intentionally minimal.

### 3. Required plan structure

Write `<RUN_DIR>/plan.md` with these sections:

```markdown
# Plan: <feature name>

## Context
<Why this change. The problem, the motivation, what success looks like.>

## Approach
<Recommended approach in 1–3 paragraphs. State the key technical decisions.>

## File-by-file changes
For every file you'll create, modify, or delete:

### `<absolute-or-relative path>`
- **Change**: <create|modify|delete>
- **What**: <one-paragraph description>
- **Why**: <one sentence>

## Reuse & extraction (REQUIRED — do not skip)
Two explicit lists.

### Existing code being reused
For each item: name, full path, where it'll be called from in this plan.
- `<symbol>` at `<path>` → used by `<file in this plan>` to <purpose>.

### One-time-used code being extracted into a common component
Code currently used in one place that should be promoted to shared/common as part of this work.
- `<symbol>` currently in `<path>` → extract to `<target path>` because <reason>; update call site at `<path>`.

If neither applies, write "None — verified by inspecting <list of files>." Do NOT leave this section blank or vague.

## Verification
End-to-end steps to confirm the change works:
1. <command or action>
2. <expected result>
...
Include both happy path and at least one edge case.

## Out of scope (intentional)
Things you considered but decided not to do, with one-line reasons.
```

### 4. Mark done and advance

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan.artifact "plan.md"
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> plan
```

### 5. Hand off — INVOKE `dp:plan-improve`, do not text-stop

The plugin's Stop hook will block your turn while `steps.plan-improve.status === "pending"`. Your very next action must be:

```
Skill(skill_name = "dp:plan-improve")
```

Before the Skill invocation, print a one-liner referencing `plan.md` as a **markdown link** so the user can click to open it. Compute the relative path from the consumer-project root (which is `cwd`):

```
Plan written — open [plan.md](.claude/feature-pipeline/<feature>/plan.md). Running self-review now.
```

The Skill invocation MUST still happen in this same turn.

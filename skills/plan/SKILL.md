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

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan.status running --session "<DP_SESSION_ID>"
```

### 2. Apply built-in plan-mode discipline

Same rules Claude Code uses in regular plan mode:

- Begin with a **Context** section explaining why this change is being made.
- Include only the recommended approach, not alternatives.
- Concise enough to scan quickly, detailed enough to execute.
- Reference critical files with absolute paths.
- Reference existing functions/utilities to be reused, with paths.
- Include a verification section describing end-to-end testing.
- For changes that repeat a pattern across files, describe the pattern once with a few representative paths — do not enumerate every file or line.
- Write for a reader scanning quickly: structured bullets, never run-on prose that lists every symbol.

You **may** ask interactive `AskUserQuestion` questions for genuinely unclear details. **Skip asking entirely if `state.autonomous === true`** — make the best decision and document it as a "decided" note in the plan.

### 2.5. No shortcuts — write the thorough plan

When you have two plausible plans — a quick-and-dirty patch versus a slower fix that also tidies related code, removes duplication, or extends a small refactor — **always write the thorough one**. Not the lazy one. Not "the minimal diff".

Rationale: the user will reject a shortcut plan and ask for the proper one. Writing the shortcut wastes a full review/improve/apply cycle. The plan should include:

- Removing duplication the change exposes.
- Extracting one-time-used code into a shared place if a second caller now needs it (this should already appear in the "Reuse & extraction" section below — make sure it's concrete).
- Updating ALL call sites consistently rather than patching one and leaving divergent shapes elsewhere.
- Cleaning up adjacent code that the change touches.

Thorough means the plan **covers** these as concise items — one bullet per distinct change, at the right altitude. It does NOT mean cramming every removed/added symbol and every call site into one paragraph. The detail belongs in the structured `What` bullets below (§3), described by intent and resulting shape, not as a line-by-line inventory.

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
- **What**:
  - Describe the file's intended end state / behavior after the change — what it does, not a line-by-line diff.
  - Use one short bullet per distinct change when a file has several.
  - For a large rewrite, state the resulting shape (key exports and responsibilities), not a "remove X, Y, Z / add A, B, C" inventory.
  - Name concrete symbols or signatures only where they aid execution — not exhaustively.
- **Why**: <one sentence>

When the same change repeats across many files, describe it once and list a few representative paths instead of repeating a per-file block for each.

**Avoid** (unreadable symbol inventory crammed into prose):

> **What**: Remove RetryResult, RetryDelta, sync() orchestration, run(), retryFailed(), retryStoredFailures(), buildForDate(), storedFailures getter, groupByDate(), the failures field and imports. Add exported SyncResult { failures; missing }. Add sync() and syncSubjects(ids). Change processSubjects to return CapturedFailure[]. Rename fetchSubjectsForRetry → querySubjectsByIds…

**Prefer** (scannable, intent-first):

> **What**:
> - Narrow the class to sync-and-report-failures only: `sync()` and `syncSubjects(ids)` each return `SyncResult { failures, missing }`.
> - Move retry, failure storage, and self-instantiation out (they now live in <target>).
> - `processSubjects` becomes stateless, returning `CapturedFailure[]`.

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
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan.artifact "plan.md" --session "<DP_SESSION_ID>"
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> plan --session "<DP_SESSION_ID>"
```

### 5. Hand off to `dp:plan-review` — do not text-stop

The plugin's Stop hook gates progression on Claude Code (hard block while `steps.plan-review.status === "pending"`) and auto-prompts the next skill on Cursor (soft auto-submit). Either way, advancing state.json correctly is mandatory.

Print a one-liner first, referencing `plan.md` as a **markdown link**:

```
Plan written — open [plan.md](${DP_STATE_DIR}/feature-pipeline/<feature>/plan.md). Running self-review now.
```

**On Claude Code**: your very next action MUST be a Skill-tool invocation in this same turn:

```
Skill(skill_name = "dp:plan-review")
```

**On Cursor**: there is no Skill tool — end your turn after the one-liner above. The plugin's `stop` hook will auto-submit `/plan-review` as a follow-up turn, triggering the next skill via slash-prefix auto-discovery.

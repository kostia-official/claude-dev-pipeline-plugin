---
name: plan-wrapup
description: Use when an active dev-pipeline run is at the plan-wrapup step. Final consistency check on plan.md, summarizes changes since the proposal, and asks for the user's final approval before implementation.
allowed-tools:
  - Read
  - Edit
  - Bash(bun *)
  - AskUserQuestion
---

# dp:plan-wrapup

Final sanity pass + user sign-off on `plan.md` before implementation begins.

## Inputs

- `RUN_DIR` — run directory.
- `<RUN_DIR>/plan.md` — the plan, already reviewed and patched by `dp:plan-improve` + `dp:plan-improve-apply`.
- `<RUN_DIR>/context.md` — must remain consistent with the approved plan.
- `<RUN_DIR>/review.md` — the review output (for the change summary).

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-wrapup.status running --session "<DP_SESSION_ID>"
```

### 2. Re-read `plan.md` end to end

Look for:

- The "Reuse & extraction" section is concrete (named paths, not vague).
- File-by-file changes mention every file referenced in the approach.
- Verification covers the actual scope.
- No internal contradictions between sections (e.g. approach says "use existing X", file-by-file uses Y).

If you find any inconsistency, patch the plan in place before proceeding.

### 3. Print a change summary

3–5 bullets, diff-style, of what changed during plan-improve / plan-improve-apply since the original proposal:

```
Changes since proposal:
- Added <X>
- Switched <Y> from <A> to <B>
- Removed <Z>
- ...
```

### 4. Ask for final approval

`AskUserQuestion`:

- **Question**: "Approve this plan and start implementation?"
- **Options**:
  1. **Approve** — proceed to `dp:implementation`.
  2. **Edit** — capture user feedback (use the "Other" option for free-text).
  3. **Reject** — stop the pipeline; user wants to redo planning from earlier.

### 5. Handle the answer

- **Approve**: continue to step 6.
- **Edit**:
  1. **If feedback adds new details** about the feature itself (new edge case, additional related file, changed constraint) — patch BOTH `plan.md` AND `context.md` in place. They must remain consistent.
  2. Re-read the updated `plan.md` (loop back to step 2 or step 4 as appropriate).
- **Reject**:
  1. Set `state.json.active = false` via:
     ```
     bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts abort <RUN_DIR> --session "<DP_SESSION_ID>"
     ```
  2. Tell the user: pipeline aborted; artifacts preserved at `<RUN_DIR>` for inspection.
  3. Stop.

### 6. Advance

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> plan-wrapup --session "<DP_SESSION_ID>"
```

### 7. Hand off — INVOKE `dp:implementation`, do not text-stop

The plugin's Stop hook will block your turn while `steps.implementation.status === "pending"`. Your very next action must be:

```
Skill(skill_name = "dp:implementation")
```

Before the Skill invocation, print a one-liner referencing the approved `plan.md` as a **markdown link** so the user can click back to it during implementation:

```
Plan approved — see [plan.md](.claude/feature-pipeline/<feature>/plan.md). Starting implementation now.
```

The Skill invocation MUST still happen in this same turn.

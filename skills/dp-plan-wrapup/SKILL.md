---
name: dp-plan-wrapup
description: Use when an active dev-pipeline run is at the plan-wrapup step. Final consistency check on plan.md, summarizes changes since the proposal, and asks for the user's final approval before implementation.
allowed-tools:
  - Read
  - Edit
  - Bash(bun *)
  - AskUserQuestion
---

# dp:dp-plan-wrapup

Final sanity pass + user sign-off on `plan.md` before implementation begins.

## Inputs

- `RUN_DIR` — run directory.
- `<RUN_DIR>/plan.md` — the plan, already reviewed and patched by `dp:dp-plan-review` + `dp:dp-plan-review-apply`.
- `<RUN_DIR>/context.md` — must remain consistent with the approved plan.
- `<RUN_DIR>/plan-review.md` — the review output (for the change summary).

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.dp-plan-wrapup.status running --session "<DP_SESSION_ID>"
```

### 2. Re-read `plan.md` end to end

Look for:

- The "Reuse & extraction" section is concrete (named paths, not vague).
- File-by-file changes mention every file referenced in the approach.
- Verification covers the actual scope.
- No internal contradictions between sections (e.g. approach says "use existing X", file-by-file uses Y).

If you find any inconsistency, patch the plan in place before proceeding.

### 3. Print a change summary

3–5 bullets, diff-style, of what changed during plan-review / plan-review-apply since the original proposal:

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
  1. **Approve** — proceed to `dp:dp-implementation`.
  2. **Approve — skip code review** — proceed to `dp:dp-implementation`, but skip the final code-review steps (`dp:dp-code-review` + `dp:dp-code-review-apply`) once implementation finishes.
  3. **Edit** — capture user feedback (use the "Other" option for free-text).
  4. **Reject** — stop the pipeline; user wants to redo planning from earlier.

### 5. Handle the answer

- **Approve**: continue to step 6.
- **Approve — skip code review**: set the skip flag, then continue to step 6. When `dp:dp-implementation` finishes, `advance` auto-skips both code-review steps and the run ends there.
  ```
  bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> skipReview true --session "<DP_SESSION_ID>"
  ```
- **Edit**:
  1. **If feedback adds new details** about the feature itself (new edge case, additional related file, changed constraint) — patch BOTH `plan.md` AND `context.md` in place. They must remain consistent.
  2. Re-read the updated `plan.md` (loop back to step 2 or step 4 as appropriate).
- **Reject**:
  1. Set `state.json.active = false` via:
     ```
     bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts abort <RUN_DIR> --session "<DP_SESSION_ID>"
     ```
  2. Tell the user: pipeline aborted; artifacts preserved at `<RUN_DIR>` for inspection.
  3. Stop.

### 6. Advance

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> dp-plan-wrapup --session "<DP_SESSION_ID>"
```

### 7. Hand off to `dp:dp-implementation` — do not text-stop

The plugin's Stop hook gates progression on Claude Code (hard block while `steps.dp-implementation.status === "pending"`) and auto-prompts the next skill on Cursor (soft auto-submit). Either way, advancing state.json correctly is mandatory.

Print a one-liner first, referencing the approved `plan.md` as a **markdown link**:

```
Plan approved — see [plan.md](${DP_STATE_DIR}/feature-pipeline/<feature>/plan.md). Starting implementation now.
```

**On Claude Code**: your very next action MUST be a Skill-tool invocation in this same turn:

```
Skill(skill_name = "dp:dp-implementation")
```

**On Cursor**: there is no Skill tool — end your turn after the one-liner above. The plugin's `stop` hook will auto-submit `/dp-implementation` as a follow-up turn, triggering the next skill via slash-prefix auto-discovery.

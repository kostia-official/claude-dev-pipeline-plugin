---
name: code-review-apply
description: Use when an active dev-pipeline run is at the code-review-apply step. Walks code-review.md findings one-by-one as todos, reasons about each fix in isolation, applies CONFIRMED fixes to the working tree (PLAUSIBLE stay as recommendations, Promise.all never auto-applied), then fills the doc's Applied/Skipped sections. Terminal step. Self-contained.
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash(bun *)
  - TodoWrite
---

# dp:code-review-apply

Apply the review findings from `dp:code-review` to the working tree, one finding at a time. The findings in `code-review.md` are **already adversarially verified** (CONFIRMED or PLAUSIBLE) — this step does not re-litigate whether they are real; it applies the confirmed ones and records the outcome. This is the **terminal step** of the pipeline.

## Inputs

- `RUN_DIR` — run directory.
- `<RUN_DIR>/code-review.md` — verified findings from `dp:code-review`.

If `code-review.md` ends with `No issues found.`, skip to step 4 (advance) and print the closing line.

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.code-review-apply.status running --session "<DP_SESSION_ID>"
```

### 2. One todo per finding — think separately per todo

Read `<RUN_DIR>/code-review.md`. Use `TodoWrite` to create **one todo per finding** (numbered as in the doc). Work each todo **one by one**: read that single finding, reason about **its** fix in isolation, apply or skip it, then move to the next.

**Reason about each fix independently — never draft one batched fix for all findings at once.** Each finding gets its own focused decision and its own edit.

### 3. Apply rules per finding

- **CONFIRMED** — apply the fix directly via `Edit`/`Write`.
- **PLAUSIBLE** — **do NOT apply.** It stays as a recommendation in the doc.
- **`Promise.all` is ALWAYS skipped.** Never introduce or apply a `Promise.all` parallelization edit, even when a CONFIRMED Efficiency finding proposes one. Record it under **Skipped** with rationale "Promise.all parallelization — dp:code-review-apply rule: never auto-apply".
- If a CONFIRMED fix turns out to be a false positive on closer inspection, or would change observable behavior, skip it and record it under **Skipped** with the reason — don't apply silently, don't drop silently.

After working all todos, append two sections to `<RUN_DIR>/code-review.md`:

```markdown
## Applied fixes
<CONFIRMED findings that were auto-fixed, as `file:line — what changed`>

## Skipped
<CONFIRMED findings NOT applied, with reason. PLAUSIBLE recommendations are NOT listed here — they remain in their category sections above.>
```

### 4. Mark done and advance

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> code-review-apply --session "<DP_SESSION_ID>"
```

This is the last step — `advance` will set `state.active = false` and `currentStep = "done"`.

### 5. Final hand-off

Pipeline is complete. Print a short closing line referencing the review doc and run dir as **markdown links** so the user can browse artifacts:

```
Pipeline complete — review at [code-review.md](${DP_STATE_DIR}/feature-pipeline/<feature>/code-review.md), all artifacts in [${DP_STATE_DIR}/feature-pipeline/<feature>/](${DP_STATE_DIR}/feature-pipeline/<feature>/).
```

No Skill invocation needed (this is the terminal step).

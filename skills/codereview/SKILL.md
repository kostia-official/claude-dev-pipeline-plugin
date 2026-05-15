---
name: codereview
description: Use when an active dev-pipeline run is at the codereview step. On Claude Code: invokes the official /simplify skill. On Cursor: performs an inline three-lens review (reuse, quality, efficiency).
allowed-tools:
  - Read
  - Edit
  - Bash(bun *)
  - Bash(git *)
  - Glob
  - Grep
---

# dp:codereview

Final step of the pipeline. Review the changes from this run. On Claude Code: hand off to the official `/simplify` skill. On Cursor: perform an inline three-lens review (`/simplify` is unavailable, and Cursor has no Skill-tool primitive).

## Inputs

- `RUN_DIR` — run directory.

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.codereview.status running --session "<DP_SESSION_ID>"
```

### 2. Identify the changes to review

Use `git diff` (or `git log`) to find files modified during this pipeline run. Review only those files — never unrelated working-tree changes.

### 3. Review — platform-dependent

**On Claude Code**: Invoke the official simplify skill via the Skill tool:

```
Skill(skill_name = "simplify")
```

This is the canonical review path on Claude Code. Do NOT do an inline review when `/simplify` is available.

If the Skill tool errors because `/simplify` is not installed, stop and tell the user:

> dp:codereview requires the official `/simplify` skill. Install it once:
>
>     /plugin marketplace add anthropics/claude-plugins-official
>     /plugin install code-simplifier
>
> Then re-run `/dp:codereview` (or `/dp:dev-pipeline` to resume).

Then stop. Do not advance the pipeline state — the user will retry after installing.

**On Cursor**: `/simplify` is a Claude-Code-only skill. Cursor has no programmatic Skill-tool invocation primitive anyway. Perform an inline review instead, applying the same three lenses as `/simplify`:

1. **Reuse review**: search for newly written code that duplicates existing utilities/helpers in the repo. Use `Grep`/`Glob` to find similar patterns. Flag any duplication with a path-and-line reference.
2. **Quality review**: scan the diff for hacky patterns — redundant state, parameter sprawl, near-duplicate code blocks, leaky abstractions, stringly-typed code, unnecessary JSX/element nesting (if a frontend project), nested conditionals 3+ levels deep, unnecessary or banal comments.
3. **Efficiency review**: scan for unnecessary work, missed concurrency, hot-path bloat, recurring no-op state updates, unnecessary existence checks, unbounded data structures, overly broad operations.

Apply fixes in place. Promise.all parallelization is ALWAYS skipped (same rule as the Claude Code branch).

### 4. Summarise the review — skipped first, then applied

After the review path (either `/simplify` on Claude Code or the inline three-lens review on Cursor) finishes, print a structured summary with two sections **in this order**: skipped fixes (so the user sees rejected proposals up front, with rationale), then applied fixes.

```
## Code review

### Skipped fixes (proposed but not applied)
1. `<path>:<line>` — <one-line description of what /simplify proposed>
   Skipped because: <one-line rationale — e.g. "Promise.all parallelization (dp:codereview rule: never auto-apply)", "would change observable behavior", "trade-off the user should decide".>

2. ...

### Applied fixes
1. `<path>:<line>` — <one-line description of what was changed>
2. ...
```

Rules:

- **Skipped goes first.** The user values seeing the rejected suggestions more than the applied ones — it tells them whether the model agreed with `/simplify` or pushed back.
- If `/simplify` proposed something and you (or its own logic) didn't apply it, you MUST list it under "Skipped" with the reason. Don't just drop it silently.
- **Promise.all is ALWAYS skipped.** Constraint: do not introduce or apply `Promise.all` parallelization edits. If `/simplify` flagged any, list them under "Skipped" with rationale "Promise.all parallelization — dp:codereview rule: never auto-apply".
- If a section is empty, omit it entirely (don't print "None." rows).
- File paths in the summary should be **markdown links** so the user can click — same convention as elsewhere in the pipeline.

### 5. Mark done and advance

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> codereview --session "<DP_SESSION_ID>"
```

This is the last step — `advance` will set `state.active = false` and `currentStep = "done"`.

### 6. Final hand-off

Pipeline is complete. Print a short closing line referencing the run dir as a **markdown link** so the user can browse artifacts:

```
Pipeline complete — artifacts at [${DP_STATE_DIR}/feature-pipeline/<feature>/](${DP_STATE_DIR}/feature-pipeline/<feature>/).
```

No Skill invocation needed (this is the terminal step).

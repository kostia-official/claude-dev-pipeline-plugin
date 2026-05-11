---
name: codereview
description: Use when an active dev-pipeline run is at the codereview step. Invokes the official /simplify skill on the changes from this run. Mandatory — no inline fallback.
allowed-tools:
  - Read
  - Edit
  - Bash(bun *)
  - Bash(git *)
  - Glob
  - Grep
---

# dp:codereview

Final step of the pipeline. Hand the changes from this run to the official `/simplify` skill for review. **Mandatory** — no inline fallback.

## Inputs

- `RUN_DIR` — run directory.

## Procedure

### 1. Mark running

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.codereview.status running
```

### 2. Identify the changes to review

Use `git diff` (or `git log`) to find files modified during this pipeline run. Review only those files — never unrelated working-tree changes.

### 3. Invoke `/simplify` — MANDATORY

Invoke the official simplify skill via the Skill tool:

```
Skill(skill_name = "simplify")
```

This step is required. Do NOT do an inline review. Do NOT skip /simplify because "it would have suggested nothing anyway" — let it actually run.

If the Skill tool errors because `/simplify` is not installed, stop and tell the user:

> dp:codereview requires the official `/simplify` skill. Install it once:
>
>     /plugin marketplace add anthropics/claude-plugins-official
>     /plugin install code-simplifier
>
> Then re-run `/dp:codereview` (or `/dp:dev-pipeline` to resume).

Then stop. Do not advance the pipeline state — the user will retry after installing.

### 4. Summarise the review — skipped first, then applied

After `/simplify` finishes, print a structured summary with two sections **in this order**: skipped fixes (so the user sees rejected proposals up front, with rationale), then applied fixes.

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
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> codereview
```

This is the last step — `advance` will set `state.active = false` and `currentStep = "done"`.

### 6. Final hand-off

Pipeline is complete. Print a short closing line referencing the run dir as a **markdown link** so the user can browse artifacts:

```
Pipeline complete — artifacts at [.claude/feature-pipeline/<feature>/](.claude/feature-pipeline/<feature>/).
```

No Skill invocation needed (this is the terminal step).

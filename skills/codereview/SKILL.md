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

### 4. Promise.all — quiet sidenote, not a section

Constraint: do NOT introduce or apply `Promise.all` parallelization edits. Other simplifications proceed normally.

If `/simplify` (or your own scan of the diff) finds places where sequential `await` calls could be parallelized with `Promise.all`, mention them as a **single inline sidenote** at the end of your chat output — no section header, no list with severities, just one short line:

```
Sidenote: a couple of Promise.all opportunities (<file>:<line>, <file>:<line>) — consider parallelizing if perf matters.
```

If there are no such opportunities, say **nothing** about Promise.all. Do not print an empty "Promise.all suggestions: None." line — that just adds noise.

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

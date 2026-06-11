---
name: codereview
description: Use when an active dev-pipeline run is at the codereview step. Runs an embedded simplify review (reuse / quality / efficiency) over this run's diff and applies fixes. Cross-platform (Claude Code + Cursor), self-contained — no external /simplify dependency.
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash(bun *)
  - Bash(git *)
  - Glob
  - Grep
  - Agent
  - TodoWrite
---

# dp:codereview

Final step of the pipeline. Review the changes from this run for reuse, quality, and efficiency, then apply the fixes.

This is a self-contained copy of Claude Code's built-in `simplify` skill, wrapped with dp pipeline rules. It does **not** depend on the external `/simplify` skill being installed, and runs identically on Claude Code and Cursor — both expose a subagent tool (Claude Code: `Agent`; Cursor 2.4+: `Task`).

## Inputs

- `RUN_DIR` — run directory.

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.codereview.status running --session "<DP_SESSION_ID>"
```

### 2. Run the review — embedded `simplify` harness

Review all changed files for reuse, quality, and efficiency. Fix any issues found.

> **Subagent tool**: Phase 2 spawns the three review agents via your platform's subagent tool — `Agent` on Claude Code, `Task` on Cursor (2.4+). Send all three calls in a single message so they run concurrently. If your platform cannot spawn ad-hoc subagents, run the three reviews sequentially in the main context instead — same checks, same output.

#### Phase 1: Identify Changes

Find the changes made during **this pipeline run**: run `git diff` (or `git diff HEAD` if there are staged changes) to see what changed. If there are no git changes, review the files this run created or edited. Review only files this run touched — never unrelated working-tree changes.

#### Phase 2: Launch Three Review Agents in Parallel

Launch all three agents concurrently in a single message. Pass each agent the full diff so it has the complete context.

##### Agent 1: Code Reuse Review

For each change:

1. **Search for existing utilities and helpers** that could replace newly written code. Look for similar patterns elsewhere in the codebase — common locations are utility directories, shared modules, and files adjacent to the changed ones.
2. **Flag any new function that duplicates existing functionality.** Suggest the existing function to use instead.
3. **Flag any inline logic that could use an existing utility** — hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, and similar patterns are common candidates.

##### Agent 2: Code Quality Review

Review the same changes for hacky patterns:

1. **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones
3. **Copy-paste with slight variation**: near-duplicate code blocks that should be unified with a shared abstraction
4. **Leaky abstractions**: exposing internal details that should be encapsulated, or breaking existing abstraction boundaries
5. **Stringly-typed code**: using raw strings where constants, enums (string unions), or branded types already exist in the codebase
6. **Unnecessary JSX nesting**: wrapper Boxes/elements that add no layout value — check if inner component props (flexShrink, alignItems, etc.) already provide the needed behavior
7. **Nested conditionals**: ternary chains (`a ? x : b ? y : ...`), nested if/else, or nested switch 3+ levels deep — flatten with early returns, guard clauses, a lookup table, or an if/else-if cascade
8. **Unnecessary comments**: comments explaining WHAT the code does (well-named identifiers already do that), narrating the change, or referencing the task/caller — delete; keep only non-obvious WHY (hidden constraints, subtle invariants, workarounds)

##### Agent 3: Efficiency Review

Review the same changes for efficiency:

1. **Unnecessary work**: redundant computations, repeated file reads, duplicate network/API calls, N+1 patterns
2. **Missed concurrency**: independent operations run sequentially when they could run in parallel
3. **Hot-path bloat**: new blocking work added to startup or per-request/per-render hot paths
4. **Recurring no-op updates**: state/store updates inside polling loops, intervals, or event handlers that fire unconditionally — add a change-detection guard so downstream consumers aren't notified when nothing changed. Also: if a wrapper function takes an updater/reducer callback, verify it honors same-reference returns (or whatever the "no change" signal is) — otherwise callers' early-return no-ops are silently defeated
5. **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern) — operate directly and handle the error
6. **Memory**: unbounded data structures, missing cleanup, event listener leaks
7. **Overly broad operations**: reading entire files when only a portion is needed, loading all items when filtering for one

#### Phase 3: Fix Issues

Wait for all three agents to complete. Aggregate their findings and fix each issue directly. If a finding is a false positive or not worth addressing, note it and move on — do not argue with the finding, just skip it.

**Promise.all is ALWAYS skipped.** Do not introduce or apply `Promise.all` parallelization edits, even when Agent 3's "Missed concurrency" check flags one. List any such finding under Skipped in the summary below.

### 3. Summarise the review — skipped first, then applied

Print a structured summary with two sections **in this order**: skipped findings (so the user sees rejected suggestions up front, with rationale), then applied fixes.

```
## Code review

### Skipped fixes (proposed but not applied)
1. `<path>:<line>` — <one-line description of the finding>
   Skipped because: <one-line rationale — e.g. "Promise.all parallelization (dp:codereview rule: never auto-apply)", "would change observable behavior", "false positive".>

2. ...

### Applied fixes
1. `<path>:<line>` — <one-line description of what was changed>
2. ...
```

Rules:

- **Skipped goes first.** The user values seeing the rejected suggestions more than the applied ones — it tells them whether the model agreed with the review or pushed back.
- If a finding surfaced and you didn't apply it, you MUST list it under "Skipped" with the reason. Don't drop it silently.
- **Promise.all is ALWAYS skipped** with rationale "Promise.all parallelization — dp:codereview rule: never auto-apply".
- If a section is empty, omit it entirely (don't print "None." rows). If all three agents found nothing, say so plainly.
- File paths in the summary should be **markdown links** so the user can click — same convention as elsewhere in the pipeline.

### 4. Mark done and advance

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> codereview --session "<DP_SESSION_ID>"
```

This is the last step — `advance` will set `state.active = false` and `currentStep = "done"`.

### 5. Final hand-off

Pipeline is complete. Print a short closing line referencing the run dir as a **markdown link** so the user can browse artifacts:

```
Pipeline complete — artifacts at [${DP_STATE_DIR}/feature-pipeline/<feature>/](${DP_STATE_DIR}/feature-pipeline/<feature>/).
```

No Skill invocation needed (this is the terminal step).

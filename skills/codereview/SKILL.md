---
name: codereview
description: Use when an active dev-pipeline run is at the codereview step. Runs a full /code-review-style review over this run's diff — 8 finder angles (3 correctness + reuse/simplification/efficiency + altitude + conventions), an adversarial verify pass, then writes a review doc and applies the CONFIRMED fixes. Cross-platform (Claude Code + Cursor), self-contained.
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

Final step of the pipeline. Review this run's changes the way Claude Code's built-in `/code-review` does — find bugs and cleanup across 8 angles, adversarially verify every candidate, then write a review doc (`codereview.md`) and apply the CONFIRMED fixes.

This is a self-contained port of `/code-review` (high effort, no output cap) wrapped with dp pipeline rules. It does **not** depend on the external `/code-review` or `/simplify` skills being installed, and runs identically on Claude Code and Cursor — both expose a subagent tool (Claude Code: `Agent`; Cursor 2.4+: `Task`).

Behaviour chosen for the pipeline:
- **Depth**: high effort — all 8 finder angles, 1-vote verify, recall-biased. **No output cap** — every finding that survives verification goes in the doc.
- **Apply**: auto-apply only verifier-**CONFIRMED** findings. **PLAUSIBLE** findings are written into the doc as recommendations, not applied. **REFUTED** are dropped.

## Inputs

- `RUN_DIR` — run directory.

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.codereview.status running --session "<DP_SESSION_ID>"
```

> **Subagent tool**: Phases 1 and 2 spawn agents via your platform's subagent tool — `Agent` on Claude Code, `Task` on Cursor (2.4+). Send parallel calls in a single message so they run concurrently. If your platform cannot spawn ad-hoc subagents, run the angles/verifiers sequentially in the main context instead — same checks, same output.

### Phase 0 — Gather the diff

Find the changes made during **this pipeline run**: run `git diff HEAD` (working tree) and, if there are commits on top of the base, `git diff <base>...HEAD`. If there are no git changes, review the files this run created or edited. **Review only files this run touched — never unrelated working-tree changes.** Treat this diff as the review scope. Finders may Read the enclosing function and callers/callees of touched code (bugs in unchanged lines of a touched function, or at a changed symbol's call sites, are in scope).

### Phase 1 — Find candidates (8 angles, ≤6 candidates each)

Run **8 independent finder angles** as parallel agents. Each returns **up to 6** candidates. Framing for every finder: *review for recall — catch every real issue a careful reviewer would catch in one sitting; err on the side of surfacing. Pass through every candidate with a nameable failure scenario — do not silently drop half-believed candidates; that bypasses the verify step and is the dominant cause of misses.*

**Correctness angles (bugs):**

- **A — line-by-line diff scan.** Read every hunk line by line, then Read the enclosing function. For every line ask: what input, state, timing, or platform makes this wrong? Look for inverted/wrong conditions, off-by-one, null/undefined deref, missing `await`, falsy-zero checks, wrong-variable copy-paste, errors swallowed in catch, unescaped regex metachars.
- **B — removed-behavior auditor.** For every line the diff DELETES or replaces, name the invariant/behavior it enforced, then find where the new code re-establishes it. If you can't, that's a candidate: a removed guard, dropped error path, narrowed validation, deleted test that covered a real case.
- **C — cross-file tracer.** For each function the diff changes, Grep its callers and check whether the change breaks a call site (new precondition, changed return shape, new exception, ordering dependency). Check callees too: does another change in this same diff make a call unsafe?

**Cleanup angles (in the changed code):**

- **Reuse.** Flag new code that re-implements something the codebase already has — Grep shared/utility modules and files adjacent to the change; name the existing helper to call instead.
- **Simplification.** Flag unnecessary complexity the diff adds: redundant/derivable state, copy-paste with slight variation, deep nesting, dead code left behind. Name the simpler form.
- **Efficiency.** Flag wasted work the diff introduces: redundant computation/repeated I/O, independent ops run sequentially, blocking work in startup/hot paths. Also flag long-lived objects built from closures/captured environments (they keep the whole enclosing scope alive — a leak when it holds large values); prefer a struct that copies only the fields it needs. Name the cheaper alternative.

**Altitude angle:**

- **Altitude.** Check each change is implemented at the right depth, not a fragile bandaid. Special cases layered on shared infrastructure signal the fix isn't deep enough — prefer generalizing the underlying mechanism over adding special cases.

**Conventions angle:**

- **Conventions (CLAUDE.md).** Find the CLAUDE.md files governing the changed code: user-level `~/.claude/CLAUDE.md`, repo-root `CLAUDE.md`, and any `CLAUDE.md`/`CLAUDE.local.md` in a directory that is an ancestor of a changed file (a directory's CLAUDE.md applies only to files at or below it). Read each, then flag clear violations. **Only flag when you can quote the exact rule and the exact line that breaks it** — no style preferences, no "spirit of the doc". If no CLAUDE.md applies, return nothing for this angle.

**Every finder returns a JSON array of candidate objects — nothing else:**

```json
[
  {
    "angle": "line-scan | removed-behavior | cross-file | reuse | simplification | efficiency | altitude | conventions",
    "category": "correctness | reuse | simplification | efficiency | altitude | conventions",
    "severity": "critical | high | medium | low",
    "file": "path/to/file.ext",
    "line": 123,
    "summary": "one-sentence statement of the issue",
    "failure_scenario": "concrete inputs/state → wrong output/crash (for cleanup/altitude/conventions: the concrete cost — what is duplicated, wasted, harder to maintain, or which rule is broken)",
    "evidence": "the exact offending line(s), quoted",
    "suggested_fix": "what to change, briefly",
    "rule_source": "CLAUDE.md path — conventions only, else omit",
    "rule_quote": "exact rule text — conventions only, else omit"
  }
]
```

### Phase 2 — Verify (1-vote, recall-biased)

Aggregate all candidates. **Assign each a sequential id** and **dedup near-duplicates** (same defect + same location + same reason → keep one). Then run **one verifier agent per remaining candidate**, passing it the diff, the relevant file(s), and the candidate.

Verifier rubric (give it verbatim):

- **PLAUSIBLE by default** — do not refute a candidate for being "speculative" or "depends on runtime state" when the state is realistic: concurrency races, nil/undefined on a rare-but-reachable path (error handler, cold cache, missing optional field), falsy-zero treated as missing, off-by-one on a boundary the code doesn't exclude, retry storms / partial failures, regex/allowlist that lost an anchor.
- **REFUTED only when constructible from the code**: factually wrong (quote the actual line), provably impossible (type/constant/invariant — show it), already handled in this diff (cite the guard), or pure style with no observable effect.
- **CONFIRMED** when verified as a real issue that will be hit in practice.

Each verifier returns exactly:

```json
{ "ref": "<candidate id>", "verdict": "CONFIRMED | PLAUSIBLE | REFUTED", "reasoning": "1–2 lines" }
```

Join verdicts back by `ref`. **Keep CONFIRMED and PLAUSIBLE; drop REFUTED.** Rank survivors most-severe first, with **correctness outranking cleanup/altitude/conventions** at equal severity.

### Phase 3 — Write the review doc

Write `<RUN_DIR>/codereview.md`. List **every** CONFIRMED and PLAUSIBLE finding (no cap). Group by category, correctness first, most-severe first within each group. Mark each finding's verdict; CONFIRMED correctness/cleanup will be auto-applied in Phase 4, PLAUSIBLE are recommendations.

```markdown
# Code Review: <feature>

## Summary
<N correctness / M cleanup findings · CONFIRMED x / PLAUSIBLE y · scope: <diff range> · effort: high>
<one line on overall health, then: applied x CONFIRMED fixes; left y PLAUSIBLE as recommendations>

## Correctness
### 1. [CONFIRMED · HIGH] <summary> — [`file:line`](file#Lline)
- **What**: <the issue>
- **Failure scenario**: <concrete inputs/state → wrong output/crash>
- **Evidence**:
  ```<lang>
  <the offending lines>
  ```
- **Suggested fix**: <what to change>
- **Verdict**: CONFIRMED — <verifier reasoning>

### 2. [PLAUSIBLE · MEDIUM] ...
...

## Reuse
## Simplification
## Efficiency
## Altitude
## Conventions
<same entry shape; each Conventions entry cites its CLAUDE.md rule: **Rule**: `<rule_source>` — "<rule_quote>">

## Applied fixes
<filled in Phase 4 — CONFIRMED findings that were auto-fixed, as `file:line — what changed`>

## Skipped
<CONFIRMED findings NOT applied, with reason — e.g. Promise.all parallelization; PLAUSIBLE recommendations are listed in their category sections above, not here>
```

Omit any category section that has no findings. If nothing survives verification, write a doc whose Summary says so plainly and skip the empty sections.

### Phase 4 — Apply the CONFIRMED fixes

Apply each **CONFIRMED** finding's fix directly via `Edit`/`Write`. **Do NOT apply PLAUSIBLE findings** — they stay as recommendations in the doc.

- **`Promise.all` is ALWAYS skipped.** Never introduce or apply a `Promise.all` parallelization edit, even when an Efficiency CONFIRMED finding proposes one. List it under **Skipped** with rationale "Promise.all parallelization — dp:codereview rule: never auto-apply".
- If a CONFIRMED fix turns out to be a false positive on closer inspection or would change observable behavior, skip it and record it under **Skipped** with the reason — don't apply silently, don't drop silently.

After applying, fill the doc's **Applied fixes** and **Skipped** sections.

### 5. Record the artifact, mark done and advance

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.codereview.artifact "codereview.md" --session "<DP_SESSION_ID>"
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> codereview --session "<DP_SESSION_ID>"
```

This is the last step — `advance` will set `state.active = false` and `currentStep = "done"`.

### 6. Final hand-off

Pipeline is complete. Print a short closing line referencing the review doc and run dir as **markdown links** so the user can browse artifacts:

```
Pipeline complete — review at [codereview.md](${DP_STATE_DIR}/feature-pipeline/<feature>/codereview.md), all artifacts in [${DP_STATE_DIR}/feature-pipeline/<feature>/](${DP_STATE_DIR}/feature-pipeline/<feature>/).
```

No Skill invocation needed (this is the terminal step).

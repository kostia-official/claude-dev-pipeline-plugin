---
name: dp-code-review
description: Use when an active dev-pipeline run is at the code-review step. Runs a full /code-review-style review over this run's diff — 8 finder angles (3 correctness + reuse/simplification/efficiency + altitude + conventions), an adversarial verify pass, then writes a ranked findings doc to code-review.md. Applying fixes is the next step (dp:dp-code-review-apply). Cross-platform (Claude Code + Cursor), self-contained.
allowed-tools:
  - Read
  - Write
  - Bash(bun *)
  - Bash(git *)
  - Glob
  - Grep
  - Agent
---

# dp:dp-code-review

Review this run's changes the way Claude Code's built-in `/dp-code-review` does — find bugs and cleanup across 8 angles, adversarially verify every candidate, then write a ranked findings doc (`code-review.md`). This step **finds and verifies only**; `dp:dp-code-review-apply` walks the doc and applies the fixes.

This is a self-contained port of `/dp-code-review` (high effort, no output cap) wrapped with dp pipeline rules. It does **not** depend on the external `/dp-code-review` or `/simplify` skills being installed, and runs identically on Claude Code and Cursor — both expose a subagent tool (Claude Code: `Agent`; Cursor 2.4+: `Task`).

Behaviour:
- **Depth**: high effort — all 8 finder angles, 1-vote verify, recall-biased. **No output cap** — every finding that survives verification goes in the doc.
- **Verdicts**: the doc marks each finding CONFIRMED or PLAUSIBLE (REFUTED dropped). `dp:dp-code-review-apply` auto-applies CONFIRMED and leaves PLAUSIBLE as recommendations.

## Inputs

- `RUN_DIR` — run directory.

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.dp-code-review.status running --session "<DP_SESSION_ID>"
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

Write `<RUN_DIR>/code-review.md`. List **every** CONFIRMED and PLAUSIBLE finding (no cap). **Number findings sequentially across the whole doc** (so `dp:dp-code-review-apply` can create one todo per finding), grouped by category, correctness first, most-severe first within each group. Mark each finding's verdict.

```markdown
# Code Review: <feature>

## Summary
<N correctness / M cleanup findings · CONFIRMED x / PLAUSIBLE y · scope: <diff range> · effort: high>
<one line on overall health>

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
```

Omit any category section that has no findings. `dp:dp-code-review-apply` will append **## Applied fixes** and **## Skipped** sections after it applies the fixes — do not add them here.

If nothing survives verification, write a doc whose Summary says so plainly, skip the empty sections, and end the body with exactly `No issues found.` (so `dp:dp-code-review-apply` can skip straight to advance).

### 4. Record the artifact, mark done and advance

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.dp-code-review.artifact "code-review.md" --session "<DP_SESSION_ID>"
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> dp-code-review --session "<DP_SESSION_ID>"
```

### 5. Hand off to `dp:dp-code-review-apply` — do not text-stop

The plugin's Stop hook gates progression on Claude Code (hard block while `steps.dp-code-review-apply.status === "pending"`) and auto-prompts the next skill on Cursor (soft auto-submit). Either way, advancing state.json correctly is mandatory.

Print a one-liner first, referencing `code-review.md` as a **markdown link**:

```
Code reviewed — open [code-review.md](${DP_STATE_DIR}/feature-pipeline/<feature>/code-review.md). Applying confirmed fixes now.
```

**On Claude Code**: your very next action MUST be a Skill-tool invocation in this same turn:

```
Skill(skill_name = "dp:dp-code-review-apply")
```

**On Cursor**: there is no Skill tool — end your turn after the one-liner above. The plugin's `stop` hook will auto-submit `/dp-code-review-apply` as a follow-up turn, triggering the next skill via slash-prefix auto-discovery.

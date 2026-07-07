---
name: plan-review
description: Use when an active dev-pipeline run is at the plan-review step. Fans out 7 finder subagents over plan.md (coverage, approach-soundness, invariant, blast-radius, altitude, design-efficiency, reuse/extraction), adversarially verifies every candidate, then writes a ranked findings doc to plan-review.md. Cross-platform (Claude Code + Cursor), self-contained.
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash(bun *)
  - Agent
---

# dp:plan-review

Review the PLAN before implementation. This is the plan-time analogue of `dp:code-review`: fan out finder subagents, adversarially verify every candidate, write a ranked findings doc — but the angles are the classes of defect knowable from `plan.md` + the repo **before any code exists**. Catching them here costs a one-line plan edit; catching them at `dp:code-review` costs a re-implementation loop.

Self-contained — no external skill dependency. Runs identically on Claude Code and Cursor (both expose a subagent tool: Claude Code `Agent`, Cursor 2.4+ `Task`).

Behaviour:
- **Depth**: high effort — all 7 finder angles, 1-vote verify, recall-biased. **No output cap** — every finding that survives verification goes in the doc.
- **No fixes here.** This step only finds and verifies. `dp:plan-review-apply` walks the doc and patches `plan.md`.

## Inputs

- `RUN_DIR` — run directory.
- `<RUN_DIR>/plan.md` — the plan to review (read in full).
- `<RUN_DIR>/context.md` — the requirements contract for this run (read in full; finders check the plan against it).
- `<RUN_DIR>/state.json` — for `autonomous` and run metadata.

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-review.status running --session "<DP_SESSION_ID>"
```

> **Subagent tool**: Phases 1 and 2 spawn agents via your platform's subagent tool — `Agent` on Claude Code, `Task` on Cursor (2.4+). Send parallel calls in a single message so they run concurrently. If your platform cannot spawn ad-hoc subagents, run the angles/verifiers sequentially in the main context instead — same checks, same output.

### Phase 0 — Gather inputs

Read `<RUN_DIR>/plan.md` and `<RUN_DIR>/context.md` in full — you will pass **both, inline**, to every finder in Phase 1 so each one starts with the material in hand instead of re-reading the same two files. They remain the review scope; finders Grep/Read only the repo code needed to verify a claim.

### Phase 1 — Find candidates (7 angles, ≤6 candidates each)

Run **7 independent finder angles** as parallel agents. Each returns **up to 6** candidates. Prepend to every finder's prompt (a) this shared framing and (b) the full inline text of `plan.md` and `context.md` (from Phase 0):

```
You are reviewing the implementation PLAN provided below (plan.md), before any
code exists, against the requirements (context.md, also provided below). Both
documents are included inline — do NOT re-Read them. To ground a claim in real
code, Grep/Read only the repo file you're verifying.

Review for recall — catch every real issue a careful reviewer would catch in
one sitting; err toward surfacing. Pass through every candidate with a nameable
failure scenario — do NOT silently drop half-believed candidates; that bypasses
the verify step and is the dominant cause of misses.

Return up to 6 candidates as a JSON array — nothing else. Schema per item:
{
  "angle": "<this finder's angle>",
  "category": "coverage | correctness | altitude | efficiency | reuse",
  "severity": "critical | high | medium | low",
  "plan_section": "where in plan.md (e.g. 'File-by-file: src/foo.ts', 'Approach')",
  "affected_path": "repo file/symbol the issue concerns, or null",
  "summary": "one sentence",
  "failure_scenario": "concrete: what breaks at implementation/runtime if the plan ships as-is",
  "evidence": "exact quote from plan.md and/or the repo line",
  "suggested_fix": "what to add/change in the plan"
}
```

Then give each finder its angle-specific instruction:

**1 — Coverage auditor** (`angle: coverage`, `category: coverage`)
```
Read context.md IN FULL — its sections: Feature explanation, Related files,
Existing code worth reusing, Risks & unknowns. For every requirement,
sub-requirement, related file, and named risk, find where plan.md addresses it.
Anything in scope that the plan does NOT address is a candidate. Also flag the
reverse: scope plan.md adds that context.md never asked for (silent creep).
failure_scenario = "requirement X ships unimplemented / risk Y never mitigated".
```

**2 — Approach-soundness auditor** (`angle: approach-soundness`, `category: correctness`)
```
Read the Approach and File-by-file sections. For each described mechanism ask:
is the assumption about how existing code/APIs behave correct? (verify by Reading
the referenced code). Is the step ordering sound? Does the design introduce a
race, an unhandled edge case, or a wrong state transition that manifests no
matter how cleanly it's coded? Flag wrong assumptions, logic gaps, missing
error/edge handling in the DESIGN. failure_scenario = concrete input/state →
wrong outcome, independent of implementation quality.
```

**3 — Invariant auditor** (`angle: invariant`, `category: correctness`)
```
For every behavior, guard, validation, error path, or test the plan says it will
remove, replace, narrow, or move: name the invariant it currently enforces
(verify by Reading the current code), then find where plan.md re-establishes it.
If the plan doesn't, that's a candidate — a dropped guard, lost error path,
narrowed validation, deleted coverage. failure_scenario = the exact state that
guard protected against, now left unprotected.
```

**4 — Blast-radius tracer** (`angle: blast-radius`, `category: correctness`)
```
For each function, method, type, or exported symbol the plan changes (new
signature, changed return shape, new precondition, new exception, changed
ordering): Grep the repo for ALL callers and usages. Check plan.md updates every
one. Any caller the plan doesn't mention is a candidate. Check callees too: does
another change in this same plan make a call the plan describes unsafe?
failure_scenario = named call site at path:line breaks or compiles-but-misbehaves.
```

**5 — Altitude / bandaid detector** (`angle: altitude`, `category: altitude`)
```
For each change ask: right altitude, or a special-case bandaid layered on shared
infrastructure? Special cases piled on a shared mechanism signal the fix isn't
deep enough — prefer generalizing the underlying mechanism. Flag: per-caller
patches that should be one change in the shared path; conditionals that special-
case a symptom instead of the cause; duplication that should be extracted BEFORE
the change, not patched around. failure_scenario = the fragility/maintenance cost
and the next case that will re-break it.
```

**6 — Design-efficiency finder** (`angle: design-efficiency`, `category: efficiency`)
```
Flag wasted work the DESIGN bakes in (architectural, not micro-optimizations):
N+1 / per-item I/O in a loop the plan describes; independent ops forced
sequential that could be structured concurrently; expensive work placed in a
startup or hot path; re-fetching/re-computing data already in hand; long-lived
objects built from closures capturing a large scope. These are one-line fixes in
the plan but rewrites after implementation. Name the cheaper structure.
failure_scenario = the scale/frequency at which it bites.
```

**7 — Reuse & extraction verifier** (`angle: reuse-extraction`, `category: reuse`)
```
Verify plan.md's "Reuse & extraction" section:
- "Existing code being reused" entries must name real symbols + concrete paths;
  verify each symbol EXISTS (Grep/Read). Vague text ("reuse existing utilities")
  → HIGH candidate.
- "Extraction" entries must name source path AND target path AND the call site to
  update. Vague → MEDIUM. Section missing entirely → HIGH.
- "None — verified by inspecting <files>" is acceptable — do NOT flag.
Additionally, independently Grep shared/utility modules and files adjacent to the
change for helpers the plan reinvents instead of reusing — a reuse the plan
missed is a candidate. failure_scenario = duplication that will be built, or an
extraction that silently won't happen.
```

### Phase 2 — Verify (1-vote, recall-biased)

Aggregate all candidates. **Assign each a sequential id** and **dedup near-duplicates** (same defect + same location + same reason → keep one). Then run **one verifier agent per remaining candidate**, passing it `plan.md`, `context.md`, the relevant repo file(s), and the candidate.

Verifier rubric (give it verbatim):

```
Adversarially verify ONE plan-review candidate before it enters the review. You
have plan.md, context.md, and the repo (Read/Grep). Does this issue really exist
in the plan as written?
- CONFIRMED — implemented as written, the plan hits this; name the concrete
  consequence.
- PLAUSIBLE — realistic but hinges on how implementation resolves an ambiguity
  the plan leaves open; keep as a recommendation.
- REFUTED — only when constructible from the plan or code: plan already addresses
  it (cite the section), the claimed caller/symbol doesn't exist (show it), or
  pure style with no consequence. Do NOT refute for being "speculative" when the
  design gap is real.
Return exactly: { "ref": "<candidate id>", "verdict": "...", "reasoning": "1–2 lines" }
```

Join verdicts back by `ref`. **Keep CONFIRMED and PLAUSIBLE; drop REFUTED.** Rank survivors most-severe first; **coverage and correctness angles (coverage, approach-soundness, invariant, blast-radius) outrank cleanup (altitude, efficiency, reuse)** at equal severity.

### Phase 3 — Write the review doc

Write `<RUN_DIR>/plan-review.md` as a **flat numbered list** (so `dp:plan-review-apply` can create one todo per finding). List **every** CONFIRMED and PLAUSIBLE finding — no cap.

```markdown
# Plan Review: <feature>

## Summary
<N findings · CONFIRMED x / PLAUSIBLE y · scope: plan.md vs context.md + repo · effort: high>
<one line on overall plan health>

## Findings
Ranked most-severe first; coverage/correctness outrank cleanup at equal severity.

### 1. [CONFIRMED · HIGH · blast-radius] <title>
- **Where**: <plan section> · affects `<repo path/symbol>`
- **What**: <the issue>
- **Failure scenario**: <what breaks at implementation/runtime if the plan ships as-is>
- **Evidence**:
  ```
  <quote from plan.md and/or the repo line>
  ```
- **Suggested fix**: <what to add/change in the plan>
- **Verdict**: CONFIRMED — <verifier reasoning>

### 2. [PLAUSIBLE · MEDIUM · efficiency] ...
...
```

If nothing survives verification, write the file with its sole content being exactly:

```
No issues found.
```

(`dp:plan-review-apply` keys off that exact line to skip straight to advance.)

### 4. Record the artifact, mark done and advance

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-review.artifact "plan-review.md" --session "<DP_SESSION_ID>"
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> plan-review --session "<DP_SESSION_ID>"
```

### 5. Hand off to `dp:plan-review-apply` — do not text-stop

The plugin's Stop hook gates progression on Claude Code (hard block while `steps.plan-review-apply.status === "pending"`) and auto-prompts the next skill on Cursor (soft auto-submit). Either way, advancing state.json correctly is mandatory.

Print a one-liner first, referencing `plan-review.md` as a **markdown link**:

```
Plan reviewed — open [plan-review.md](${DP_STATE_DIR}/feature-pipeline/<feature>/plan-review.md). Applying fixes now.
```

**On Claude Code**: your very next action MUST be a Skill-tool invocation in this same turn:

```
Skill(skill_name = "dp:plan-review-apply")
```

**On Cursor**: there is no Skill tool — end your turn after the one-liner above. The plugin's `stop` hook will auto-submit `/plan-review-apply` as a follow-up turn, triggering the next skill via slash-prefix auto-discovery.

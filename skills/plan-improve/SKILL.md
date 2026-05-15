---
name: plan-improve
description: Use when an active dev-pipeline run is at the plan-improve step. Reviews plan.md for correctness, missing pieces, and weak points; writes a numbered issue list to review.md. Self-contained — embeds the original /plan-improve discipline plus dp-specific reuse/extraction checks.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash(bun *)
---

# dp:plan-improve

Review the plan. **Self-contained**: this skill embeds the original `/plan-improve` discipline verbatim, then layers dp-specific extensions. It does NOT invoke `/plan-improve`.

## Inputs

- `RUN_DIR` — run directory.
- `<RUN_DIR>/plan.md` — the plan to review.

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-improve.status running --session "<DP_SESSION_ID>"
```

### 2. Review discipline

Review `<RUN_DIR>/plan.md` against `<RUN_DIR>/context.md` and the repo files the plan references.

`context.md` is the requirements document for this feature run — the reviewer SHOULD read it to verify the plan covers everything in scope. (This is a deliberate departure from the original `/plan-improve` "no context" discipline, which was designed for blind reviews. In our pipeline, context.md is part of the contract.)

Steps:

1. Read `<RUN_DIR>/plan.md`.
2. Read `<RUN_DIR>/context.md` and check the plan against its sections — Feature explanation, Related files, Existing code worth reusing, Risks & unknowns. Anything in context.md not addressed by the plan is a flag.
3. Read repo files the plan references to ground correctness review.
4. Validate correctness, flag missing pieces, weak points, and what needs more investigation.
5. Respond with a numbered list with issues sorted by severity. Each point has severity and confidence values, then a detailed description of what the found issue is.

### 3. dp-specific extension — verify "Reuse & extraction"

In addition to the normal review, verify the plan's **"Reuse & extraction"** section:

- **Existing code being reused** — entries must name actual symbols and concrete file paths. Vague text like "consider reusing existing utilities" → flag as a HIGH-severity issue.
- **One-time-used code being extracted into a common component** — entries must name source path AND target path. Vague text → flag as MEDIUM-severity issue.
- If the section is missing entirely → HIGH-severity issue.
- If the section says "None — verified by inspecting <files>" — accept it; do NOT flag.

These checks go into the same numbered list, alongside the standard correctness review.

### 4. Write `<RUN_DIR>/review.md`

Output format:

```markdown
# Review: <plan name>

1. **[HIGH | confidence: HIGH]** <issue title>
   <detailed description, what's missing, what to fix>

2. **[MEDIUM | confidence: MEDIUM]** <issue title>
   <detailed description>

3. **[LOW | confidence: HIGH]** <issue title>
   <detailed description>

...
```

If no issues are found, write a single line: `No issues found.` (still write the file — `dp:plan-improve-apply` reads it).

### 5. Mark done and advance

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-improve.artifact "review.md" --session "<DP_SESSION_ID>"
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> plan-improve --session "<DP_SESSION_ID>"
```

### 6. Hand off to `dp:plan-improve-apply` — do not text-stop

The plugin's Stop hook gates progression on Claude Code (hard block while `steps.plan-improve-apply.status === "pending"`) and auto-prompts the next skill on Cursor (soft auto-submit). Either way, advancing state.json correctly is mandatory.

Print a one-liner first, referencing `review.md` as a **markdown link**:

```
Review written — open [review.md](${DP_STATE_DIR}/feature-pipeline/<feature>/review.md). Applying fixes now.
```

**On Claude Code**: your very next action MUST be a Skill-tool invocation in this same turn:

```
Skill(skill_name = "dp:plan-improve-apply")
```

**On Cursor**: there is no Skill tool — end your turn after the one-liner above. The plugin's `stop` hook will auto-submit `/plan-improve-apply` as a follow-up turn, triggering the next skill via slash-prefix auto-discovery.

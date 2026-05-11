---
name: investigation
description: Use when an active dev-pipeline run is at the investigation step. Gathers wide context about the feature and writes a structured context.md (Feature explanation, Related files, Existing code worth reusing, Risks & unknowns).
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash(bun *)
  - Bash(ls *)
  - Bash(rg *)
  - AskUserQuestion
---

# dp:investigation

You are running the **investigation** step of an active dev-pipeline run. Your goal: build a wide context for the feature so the later planning steps can be precise.

## Inputs

- `RUN_DIR` — absolute path to the run directory (provided by the orchestrator).
- `<RUN_DIR>/state.json` — read `state.args` to get the feature description.

## Procedure

### 1. Mark the step as running

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.investigation.status running
```

### 2. Gather context — go wide, not narrow

Read the user's feature intent from `state.args`. Then:

- Identify the high-level area(s) of the codebase this feature touches.
- Read parent modules, sibling features, related models/types — not just the immediate files. Wide context matters more than depth at this stage.
- Search for existing utilities, components, or hooks that could solve sub-problems (`Grep`/`Glob`).
- Note testing patterns used nearby.
- Continue until you can confidently state what the feature is, where it lives, what it depends on, and what looks risky.

If you hit something genuinely ambiguous about the feature itself (not the codebase), ask **one** `AskUserQuestion` to disambiguate. Do not interrogate.

### 3. Write `<RUN_DIR>/context.md`

Use this exact section structure:

```markdown
# Context: <feature name>

## Feature explanation
<Plain-prose description of what the feature is. Start from state.args and clarify ambiguities. State user-visible behavior, not implementation.>

## Related files
Group by role. Use markdown links with absolute paths.

### Entry points
- `<path>` — <one-line role>

### Models / types
- ...

### Sibling features
- ...

### Shared utilities (potential reuse)
- ...

### Tests
- ...

## Existing code worth reusing
Specific functions / components / utilities already in the codebase that solve sub-problems for this feature. Each item: name, path, one-line description of what we'd reuse it for.

## Risks & unknowns
- Anything ambiguous, brittle, or potentially blocking that the next steps must address.
```

### 4. Record the artifact and advance

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.investigation.artifact "context.md"
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> investigation
```

### 5. Hand off — INVOKE THE NEXT SKILL, do not text-stop

`context.md` is a **living document** — `dp:plan-proposal` and `dp:plan-wrapup` will append to it whenever user feedback at those gates surfaces new details.

After advance, `state.steps.plan-proposal.status === "pending"`. The plugin's Stop hook will block your turn unless you invoke the next skill. So your very next action must be:

```
Skill(skill_name = "dp:plan-proposal")
```

Before the Skill invocation, print a one-liner that references `context.md` as a **markdown link** so the user can click to open it. Compute the relative path from the consumer-project root (which is `cwd`):

```
Investigation complete — wrote [context.md](.claude/feature-pipeline/<feature>/context.md). Continuing to plan-proposal.
```

The Skill invocation MUST still happen in this same turn.

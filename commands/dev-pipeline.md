---
description: Start, resume, or continue a feature-planning pipeline run. Accepts a feature description (new run), a path to a state.json/context.md/plan.md (explicit resume), or a phrase like "continue <feature>" / "find plan for <feature>" (implicit resume).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(bun *)
  - Bash(mkdir *)
  - Bash(ls *)
  - Bash(test *)
  - Bash(realpath *)
  - Glob
  - Grep
  - AskUserQuestion
---

# /dp:dev-pipeline — orchestrator

You are starting or resuming a `dp` (dev-pipeline) feature-planning run. Follow this procedure exactly.

## Inputs

- `$ARGUMENTS` — free-form text. Could be a feature description, a path, or a phrase like "continue <name>".
- Working directory (`pwd`) — the **consumer project root** where pipeline state will live at `<pwd>/.claude/feature-pipeline/<name>/`.

## Step 1 — Classify `$ARGUMENTS`

Pick exactly one classification:

### A. Explicit continuation by path

`$ARGUMENTS` is a filesystem path (absolute, `~`-prefixed, or relative). Detect with: starts with `/`, `~/`, `./`, `../`, OR matches an existing path when resolved.

- If it's a directory → expect `<dir>/state.json` to exist → resume that run.
- If it's a file ending in `state.json` / `context.md` / `plan.md` / `review.md` → resolve to its parent directory → resume.
- Otherwise (path doesn't exist, or has no `state.json`) → tell the user the path is invalid and **stop**. Do not auto-create at an explicit path.

### B. Implicit continuation by phrasing

`$ARGUMENTS` (lower-cased, trimmed) starts with one of these continuation keywords/phrases:

`continue`, `resume`, `check`, `find`, `pick up`, `keep going`, `where were we`

Strategy:

1. Strip the keyword. The remainder is the candidate feature description.
2. List `<pwd>/.claude/feature-pipeline/*/state.json` (use Glob).
3. For each, read `state.json` and consider only those with `active: true`.
4. Match by:
   - Exact slug match against directory name, OR
   - Prefix match (slug starts-with the slugified remainder), OR
   - Fuzzy substring match on `state.args` or `state.name` (case-insensitive).
5. Resolution:
   - **Exactly one match** → resume that run.
   - **Zero matches** → list ALL active runs (their names + step + last update) via `AskUserQuestion`: "Which run should I continue?". Include "None — start a new run instead" as the last option.
   - **Multiple matches** → list candidates via `AskUserQuestion`.

### C. New run

Anything else: treat `$ARGUMENTS` as a feature description.

1. Slugify into `<slug>` (lowercase, kebab-case, strip non-alphanumerics, collapse multiple `-`).
2. **Collision check**: if `<pwd>/.claude/feature-pipeline/<slug>/state.json` already exists with `active: true`, ask via `AskUserQuestion`: "A run already exists for `<slug>` — continue it or start fresh?" with options: "Continue it" / "Start fresh (suffix with -2)" / "Cancel".
3. Otherwise create a new run (Step 2).

## Step 2 — Create or load the run

### For new runs

```
mkdir -p <pwd>/.claude/feature-pipeline/<slug>/
```

Write `<run-dir>/state.json` with this initial content (substitute current ISO timestamp and the original `$ARGUMENTS` into `args`):

```json
{
  "name": "<slug>",
  "createdAt": "<ISO timestamp>",
  "active": true,
  "autonomous": false,
  "currentStep": "investigation",
  "steps": {
    "investigation":      { "status": "pending" },
    "plan-proposal":      { "status": "pending" },
    "plan":               { "status": "pending" },
    "plan-improve":       { "status": "pending" },
    "plan-improve-apply": { "status": "pending" },
    "plan-wrapup":        { "status": "pending" },
    "implementation":     { "status": "pending" },
    "codereview":         { "status": "pending" }
  },
  "args": "<original $ARGUMENTS>"
}
```

### For resumed runs

Just read `<run-dir>/state.json` — do not overwrite.

## Step 3 — Announce

Print a 3-line status:

```
Pipeline: <name>
State:    <run-dir>
Step:     <currentStep>  (<status of currentStep>)
```

## Step 4 — Invoke the matching skill IMMEDIATELY

This is **mandatory**, not a hand-off note. After printing the announce block in step 3, your **very next action** in this same response MUST be a Skill-tool invocation of the skill matching `state.currentStep`. The pipeline does not progress otherwise — and the plugin's Stop hook (`enforce-pipeline-progress.ts`) will hard-block your turn from ending while `steps[currentStep].status === "pending"`.

Mapping:

| currentStep | Skill to invoke |
|---|---|
| investigation | `dp:investigation` |
| plan-proposal | `dp:plan-proposal` |
| plan | `dp:plan` |
| plan-improve | `dp:plan-improve` |
| plan-improve-apply | `dp:plan-improve-apply` |
| plan-wrapup | `dp:plan-wrapup` |
| implementation | `dp:implementation` |
| codereview | `dp:codereview` |

Concretely, immediately call:

```
Skill(skill_name = "dp:<currentStep>")
```

Pass the run directory absolute path so the skill knows where to read/write artifacts.

**Do NOT do any of the following:**
- Print "Handing off to <step>" or similar and end your turn.
- Tell the user to invoke the skill themselves.
- Stop after the announce block.

If you find yourself about to do any of those, you have already failed step 4 — go back and call the Skill tool instead.

## Convention — clickable artifact paths

Whenever a skill (or this orchestrator) mentions a written artifact (`context.md`, `plan.md`, `review.md`, run-dir), it MUST format the path as a **markdown link** so the user can click to open it in the IDE:

- Format: `[<filename>](<path-relative-to-cwd>)`
- The consumer-project root IS `cwd`, so the relative path is `.claude/feature-pipeline/<feature>/<filename>`.
- Example: `[plan.md](.claude/feature-pipeline/auth-rewrite/plan.md)`

Never reference these artifacts as bare text or backtick'd code (`<RUN_DIR>/plan.md`) when announcing — make them clickable.

## Notes for ad-hoc requests (no slash command)

When the user asks things like "what's the state of my pipeline run?", "abort the current run", "show me the plan", do NOT invoke this command — just read the relevant `state.json` or artifact directly and answer in chat. Aborting = set `active: false` in `state.json` (do NOT delete files; artifacts remain for inspection).

## State helpers

All state mutations should go through:

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts <subcommand> <run-dir> [args...]
```

Subcommands:
- `init <run-dir> <slug> "<args>"` — create initial state.json
- `get <run-dir> <dotted.path>` — read a value
- `set <run-dir> <dotted.path> <json-value>` — write a value
- `advance <run-dir> <step-name>` — mark step done and bump currentStep to next
- `status <run-dir>` — print human-readable progress table

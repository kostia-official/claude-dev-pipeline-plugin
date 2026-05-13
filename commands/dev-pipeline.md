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

## Session id capture and propagation (canonical convention)

This convention is referenced by every `dp:*` skill. Read carefully — every `advance.ts` invocation in this plugin should follow it.

**Where the id comes from.** Claude Code's SessionStart hook (`scripts/hooks/capture-session.ts`) emits a `DP_SESSION_ID=<id>` line via `hookSpecificOutput.additionalContext` whenever a session starts. That line appears as a system reminder in your conversation context. The same hook also appends `export DP_SESSION_ID=<id>` to `$CLAUDE_ENV_FILE` for bash subprocess fallback.

**How to extract it.** Scan the conversation's system-reminder messages for a line matching the regex `^DP_SESSION_ID=(\S+)$`. If multiple matches exist (e.g. across `/clear` boundaries), take the **last** one — it reflects the current session. Call the captured value `<DP_SESSION_ID>`.

**How to use it.** When you call `bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts <set|advance|abort> ...`, append `--session "<DP_SESSION_ID>"` at the end. When you call `init`, pass `<DP_SESSION_ID>` as the 4th positional argument.

**If the line isn't in context.** Omit `--session` entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID` from the CLAUDE_ENV_FILE export. If both are absent (rare — happens after a mid-conversation upgrade before a session restart), the run will be created without a sessionId tag. Print a one-line warning and proceed.

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
3. For each, read `state.json` and consider only those with `active: true`. **Do NOT apply the session filter on this path** — the user explicitly asked to resume, so cross-session matches are intentional.
4. Match by:
   - Exact slug match against directory name, OR
   - Prefix match (slug starts-with the slugified remainder), OR
   - Fuzzy substring match on `state.args` or `state.name` (case-insensitive).
5. Resolution:
   - **Exactly one match** → resume that run (proceed to ownership transfer in step 2).
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

Then run `advance.ts init` to create `state.json`. Pass `<DP_SESSION_ID>` as the 4th positional if available, otherwise omit:

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts init <run-dir> <slug> "<args>" "<DP_SESSION_ID>"
```

The script writes the canonical initial shape (all steps pending, currentStep=investigation, active=true) and includes `sessionId` in the file when the 4th arg or `process.env.DP_SESSION_ID` is non-empty.

### For resumed runs — TRANSFER OWNERSHIP

For both the "Explicit continuation by path" and "Implicit continuation by phrasing" paths, after locating the target run:

1. Read `<run-dir>/state.json` (do not overwrite the whole file).
2. **Transfer ownership to the current session** so the Stop hook keeps enforcing progression on this run:

   ```
   bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <run-dir> sessionId '"<DP_SESSION_ID>"' --session "<DP_SESSION_ID>"
   ```

   If `<DP_SESSION_ID>` is unavailable, skip this step and print a warning — without ownership transfer the Stop hook will be inert for the resumed run.

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
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts <subcommand> <run-dir> [args...] [--session <id>]
```

Subcommands:
- `init <run-dir> <slug> "<args>" [<session-id>]` — create initial state.json. 4th positional is the session id (optional).
- `get <run-dir> <dotted.path>` — read a value
- `set <run-dir> <dotted.path> <json-value> [--session <id>]` — write a value; `--session` triggers tag-on-touch if state has no sessionId.
- `advance <run-dir> <step-name> [--session <id>]` — mark step done and bump currentStep to next; supports tag-on-touch.
- `abort <run-dir> [--session <id>]` — set active=false; supports tag-on-touch.
- `status <run-dir>` — print human-readable progress table.

When `--session` is omitted, the script falls back to `process.env.DP_SESSION_ID`. When both are absent, no tag-on-touch fires.

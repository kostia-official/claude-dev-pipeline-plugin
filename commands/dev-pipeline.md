---
description: Start, resume, or continue a feature-planning pipeline run. Accepts a feature description (new run), a path to a state.json/context.md/plan.md (explicit resume), or a phrase like "continue <feature>" / "find plan for <feature>" (implicit resume).
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(bun *)
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
- Working directory (`pwd`) — the **consumer project root** where pipeline state will live at `<pwd>/${DP_STATE_DIR}/feature-pipeline/<name>/`. `DP_STATE_DIR` is `.claude` on Claude Code and `.cursor` on Cursor (exported by the SessionStart hook). All path manipulation happens INSIDE the `advance.ts` script — you never construct these paths manually.

## Session id, plugin root, and state dir capture (canonical convention)

This convention is referenced by every `dp:*` skill. Read carefully — every `advance.ts` invocation in this plugin should follow it.

**Where the values come from.** The SessionStart hook (`scripts/hooks/capture-session.ts`) emits three lines via the harness's context-injection channel whenever a session starts:

```
DP_SESSION_ID=<id>
DP_PLUGIN_ROOT=<absolute-path-to-plugin>
DP_STATE_DIR=<.claude|.cursor>
```

On Claude Code these arrive via `hookSpecificOutput.additionalContext` and appear as a system reminder in your conversation context. The same hook also appends `export <NAME>=<value>` lines to `$CLAUDE_ENV_FILE` for bash subprocess fallback. On Cursor they arrive via the `sessionStart` hook's `env` field (propagated to every subsequent hook in the session) AND mirrored into `additional_context` so they also appear in the conversation context.

**How to extract them.** Scan the conversation's system-reminder messages for lines matching `^DP_SESSION_ID=(\S+)$`, `^DP_PLUGIN_ROOT=(\S+)$`, and `^DP_STATE_DIR=(\S+)$`. If multiple matches exist (e.g. across `/clear` boundaries), take the **last** of each — they reflect the current session.

**How to use them.** Every `bun .../scripts/cli/advance.ts ...` invocation in this plugin uses `${DP_PLUGIN_ROOT}/scripts/cli/advance.ts ...`. When you call `<set|advance|abort>`, append `--session "<DP_SESSION_ID>"`. When you call `init`, pass `<DP_SESSION_ID>` as the 3rd positional argument. The script itself reads `DP_STATE_DIR` from the environment to resolve slug → absolute path, so you pass `<slug>` (not `<run-dir>`) in the common case.

**If the lines aren't in context.** Omit `--session` entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`. If `DP_PLUGIN_ROOT` is missing the shell will expand to an empty string and the command will fail — in that case, restart the session so the SessionStart hook re-fires. If `DP_STATE_DIR` is missing, the script defaults to `.claude` (safe for Claude Code, wrong for Cursor — restart the session).

## Step 1 — Classify `$ARGUMENTS`

Pick exactly one classification:

### A. Explicit continuation by path

`$ARGUMENTS` is a filesystem path (absolute, `~`-prefixed, or relative). Detect with: starts with `/`, `~/`, `./`, `../`, OR matches an existing path when resolved.

- If it's a directory → expect `<dir>/state.json` to exist → resume that run.
- If it's a file ending in `state.json` / `context.md` / `plan.md` / `review.md` → resolve to its parent directory → resume.
- Otherwise (path doesn't exist, or has no `state.json`) → tell the user the path is invalid and **stop**. Do not auto-create at an explicit path.

When passing the resolved path to `advance.ts` it's accepted verbatim (the script auto-detects path-style vs slug-style by the presence of `/` or `~`).

### B. Implicit continuation by phrasing

`$ARGUMENTS` (lower-cased, trimmed) starts with one of these continuation keywords/phrases:

`continue`, `resume`, `check`, `find`, `pick up`, `keep going`, `where were we`

Strategy:

1. Strip the keyword. The remainder is the candidate feature description.
2. List active runs via the helper: read `${DP_STATE_DIR}` from system reminders, then `Glob` `<pwd>/${DP_STATE_DIR}/feature-pipeline/*/state.json` (using whichever literal `.claude` / `.cursor` value DP_STATE_DIR carries — `Glob` doesn't shell-expand env vars).
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
2. **Collision check**: run `bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts exists <slug>` (exits 0 always; outputs JSON). Parse the JSON: if `exists: false`, no collision — proceed. If `exists: true` and `active: true`, ask via `AskUserQuestion`: "A run already exists for `<slug>` — continue it or start fresh?" with options: "Continue it" / "Start fresh (suffix with -2)" / "Cancel". If `exists: true` but `active: false`, the previous run was aborted — proceed with the same slug (it'll be re-initialized).
3. Otherwise create a new run (Step 2).

## Step 2 — Create or load the run

### For new runs

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts init <slug> "<args>" "<DP_SESSION_ID>"
```

The script creates `<pwd>/${DP_STATE_DIR}/feature-pipeline/<slug>/` (if missing) and writes the canonical initial `state.json` (all steps pending, `currentStep=investigation`, `active=true`). The `sessionId` field is populated when the 3rd arg or `process.env.DP_SESSION_ID` is non-empty. The script prints a JSON line with `runDir` (absolute) and `relativePath` (e.g. `.cursor/feature-pipeline/<slug>`) — capture both for downstream use.

### For resumed runs — TRANSFER OWNERSHIP

For both the "Explicit continuation by path" and "Implicit continuation by phrasing" paths, after locating the target run:

1. Read `<run-dir>/state.json` (do not overwrite the whole file). Note `state.name` (the slug).
2. **Transfer ownership to the current session** so the Stop hook keeps enforcing progression on this run:

   ```
   bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <slug> sessionId '"<DP_SESSION_ID>"' --session "<DP_SESSION_ID>"
   ```

   (For path-based resume where the run is outside the current state dir, pass the absolute path instead of `<slug>` — `advance.ts` accepts either.)

   If `<DP_SESSION_ID>` is unavailable, skip this step and print a warning — without ownership transfer the Stop hook will be inert for the resumed run.

## Step 3 — Announce

Print a 3-line status with the run dir as a **markdown link**:

```
Pipeline: <name>
State:    [<relativePath>/](<relativePath>/)
Step:     <currentStep>  (<status of currentStep>)
```

`<relativePath>` is what `advance.ts init` (or `advance.ts runpath <slug>`) prints — e.g. `.cursor/feature-pipeline/auth-rewrite`. NEVER hardcode `.claude/feature-pipeline/` here; the prefix depends on the platform.

## Step 4 — Hand off to the matching skill IMMEDIATELY

After printing the announce block in step 3, hand off to the skill matching `state.currentStep` in this same response. **How** depends on the harness:

| currentStep | Skill name |
|---|---|
| investigation | `dp:investigation` (Claude Code) / `investigation` (Cursor) |
| plan-proposal | `dp:plan-proposal` / `plan-proposal` |
| plan | `dp:plan` / `plan` |
| plan-improve | `dp:plan-improve` / `plan-improve` |
| plan-improve-apply | `dp:plan-improve-apply` / `plan-improve-apply` |
| plan-wrapup | `dp:plan-wrapup` / `plan-wrapup` |
| implementation | `dp:implementation` / `implementation` |
| codereview | `dp:codereview` / `codereview` |

**On Claude Code**: your very next action in this same response MUST be a Skill-tool invocation:

```
Skill(skill_name = "dp:<currentStep>")
```

Pass the run directory absolute path so the skill knows where to read/write artifacts. The plugin's Stop hook (`enforce-pipeline-progress.ts`) will hard-block your turn from ending while `steps[currentStep].status === "pending"`.

**On Cursor**: there is no `Skill` tool. End your turn after the announce block — the plugin's `stop` hook will return a `followup_message` that auto-submits `/<currentStep>` as the next user turn, triggering the matching skill via slash-prefix auto-discovery. With `loop_limit: null` set in `hooks/cursor-hooks.json`, all 8 chained submissions fire without truncation.

## Convention — clickable artifact paths

Whenever a skill (or this orchestrator) mentions a written artifact (`context.md`, `plan.md`, `review.md`, run-dir), it MUST format the path as a **markdown link** so the user can click to open it in the IDE:

- Format: `[<filename>](<relativePath>/<filename>)`
- `<relativePath>` is `${DP_STATE_DIR}/feature-pipeline/<feature>` — substitute the literal value from the system reminder (e.g. `.cursor/feature-pipeline/auth-rewrite`). Equivalently, call `bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts runpath <slug>` to print it.
- Example (Claude Code): `[plan.md](.claude/feature-pipeline/auth-rewrite/plan.md)`
- Example (Cursor): `[plan.md](.cursor/feature-pipeline/auth-rewrite/plan.md)`

Never hardcode `.claude/` in markdown links — it breaks on Cursor.

## Notes for ad-hoc requests (no slash command)

When the user asks things like "what's the state of my pipeline run?", "abort the current run", "show me the plan", do NOT invoke this command — just read the relevant `state.json` or artifact directly and answer in chat. Aborting = `bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts abort <slug>` (do NOT delete files; artifacts remain for inspection).

## State helpers

All state mutations should go through:

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts <subcommand> <slug-or-run-dir> [args...] [--session <id>]
```

Subcommands:
- `init <slug> "<args>" [<session-id>]` — create the run dir AND write the initial state.json. Returns JSON with `runDir` (absolute) and `relativePath`.
- `runpath <slug>` — print the project-relative run path (e.g. `.cursor/feature-pipeline/foo`). Use this when constructing markdown links.
- `exists <slug-or-run-dir>` — non-throwing collision check. Always exits 0. Prints `{"exists": false, ...}` or `{"exists": true, "active": <bool>, ...}`.
- `get <slug-or-run-dir> <dotted.path>` — read a value.
- `set <slug-or-run-dir> <dotted.path> <json-value> [--session <id>]` — write a value; `--session` triggers tag-on-touch if state has no sessionId.
- `advance <slug-or-run-dir> <step-name> [--session <id>]` — mark step done and bump currentStep to next; supports tag-on-touch.
- `abort <slug-or-run-dir> [--session <id>]` — set active=false; supports tag-on-touch.
- `status <slug-or-run-dir>` — print human-readable progress table.

When `--session` is omitted, the script falls back to `process.env.DP_SESSION_ID`. When both are absent, no tag-on-touch fires.

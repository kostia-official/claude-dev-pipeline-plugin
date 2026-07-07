# claude-dev-pipeline-plugin

A Claude Code plugin (`dp` namespace) that turns feature work into an explicit, resumable, hook-enforced pipeline.

```
investigation → plan-proposal → plan → plan-improve → plan-improve-apply
              → plan-wrapup → implementation → codereview
```

State lives in your project at `.claude/feature-pipeline/<feature>/`. Artifacts (`context.md`, `plan.md`, `review.md`, `state.json`) are plain files you can read, diff, and commit.

## Quick start — Claude Code

```
/plugin marketplace add kostia-official/claude-dev-pipeline-plugin
/plugin install dp@kostia-official-claude-dev-pipeline-plugin
```

Then in any project:

```
/dp:dev-pipeline rewrite auth to use refresh tokens
```

To resume:

```
/dp:dev-pipeline continue auth-rewrite
# or pass the path directly:
/dp:dev-pipeline .claude/feature-pipeline/auth-rewrite/
```

To see the current state, just ask in chat — "what's the state of my pipeline run?" — Claude reads `state.json` and answers.

To upgrade later:

```
/plugin marketplace update claude-dev-pipeline-plugin
/reload-plugins
```

## Quick start — Cursor 2.6+

In Cursor: **Dashboard → Settings → Plugins → Team Marketplaces → Import** → paste:

```
https://github.com/kostia-official/claude-dev-pipeline-plugin
```

Review the parsed plugins, install `dp`, then restart Cursor.

In Agent chat, start a run with the orchestrator slash command (the exact name Cursor surfaces from `commands/dev-pipeline.md` may be `/dev-pipeline` or `/dp-dev-pipeline` depending on Cursor's command-naming rules — check the `/` menu after install):

```
/dev-pipeline rewrite auth to use refresh tokens
```

The pipeline works the same way as on Claude Code: state lives in `.claude/feature-pipeline/<feature>/`, artifacts are the same plain files. Step chaining is implemented via Cursor's `stop`-hook `followup_message` instead of Claude Code's `Skill` tool — functionally equivalent, but the model is *nudged* into the next step (auto-submitted follow-up turn) rather than *blocked* from stopping. The pipeline can still be derailed if you interrupt it mid-flight; manually invoke `/<next-step>` to recover.

### Differences from Claude Code

| Behavior | Claude Code | Cursor |
|---|---|---|
| Step chaining | `Skill(skill_name = "dp:<next>")` tool call | `stop` hook returns `followup_message: "Invoke /<next> now."` auto-submitted as next turn |
| Stop-hook enforcement | Hard block (`decision: "block"`) | Soft auto-prompt; loop cap raised to `null` for 8-step chains |
| Slash namespace | `/dp:<skill>` (plugin-prefixed) | `/<skill>` (flat, e.g. `/investigation`) |
| `dp:codereview` review | Invokes `/simplify` skill | Inline three-lens review (`/simplify` is Claude-Code-only) |
| Session-id propagation | `additionalContext` + `CLAUDE_ENV_FILE` append | `sessionStart` hook's `env` field (propagates to all subsequent hooks) |

### Soft dependency

`dp:codereview` wraps `/simplify` from Anthropic's official `code-simplifier` plugin **on Claude Code**. If you don't have it:

```
/plugin marketplace add anthropics/claude-plugins-official
/plugin install code-simplifier
```

If you skip this, `dp:codereview` falls back to running the simplification review itself. On Cursor this is the default — no `/simplify` install needed.

### Runtime prerequisite

The plugin's hooks and CLI scripts run on **Bun**. Install once:

```
brew install bun
# or
curl -fsSL https://bun.sh/install | bash
```

## What the pipeline does

| Step | Skill | Output | Gate |
|---|---|---|---|
| 1 | `dp:investigation` | `context.md` | — |
| 2 | `dp:plan-proposal` | (chat only) | User approves: Yes / Yes-Autonomous / No |
| 3 | `dp:plan` | `plan.md` | — |
| 4 | `dp:plan-improve` | `review.md` | — |
| 5 | `dp:plan-improve-apply` | patched `plan.md` | Per-issue questions if direction unclear |
| 6 | `dp:plan-wrapup` | finalised `plan.md` | User approves: Approve / Edit / Reject |
| 7 | `dp:implementation` | code changes | Self-policed by the skill (no `: any`, no dirty `as` — backed by lint); Stop hook blocks completion until typecheck + lint have passed |
| 8 | `dp:codereview` | review notes + diff | `Promise.all` opportunities are reported, never auto-applied |

The pipeline can run with checkpoints (default) or fully autonomous (pick "Yes — Autonomous" at the proposal gate).

### Hook enforcement (implementation step only)

One hook is scoped to `dp:implementation` — it fires **only** while that skill is active:

- **Stop**: blocks finishing the implementation step until typecheck + lint have been recorded as passing.

The skill body also instructs Claude to never introduce `: any` or dirty `as <Type>` casts — those rules are about *what code Claude writes*, not about runtime behaviour, so they belong in skill instructions and the project's lint config (e.g. `@typescript-eslint/no-explicit-any`), not in a static-analysis hook.

Outside the implementation step, normal Edit/Write/Stop are completely untouched.

### Session scoping

Each Claude Code session sees only the pipeline runs it created (or runs it explicitly resumed). Two concurrent sessions in the same project do **not** interfere with each other — one session's Stop hook will not block the other session's text-stops.

Mechanism:

- A `SessionStart` hook captures Claude Code's `session_id` from the hook event payload and exposes it to the conversation via `hookSpecificOutput.additionalContext` as a line `DP_SESSION_ID=<id>`. The hook also writes `export DP_SESSION_ID=<id>` to `$CLAUDE_ENV_FILE` for bash-subprocess fallback.
- The orchestrator and every skill body read `DP_SESSION_ID` from context and pass `--session "<id>"` to `advance.ts`. `advance.ts` also reads `process.env.DP_SESSION_ID` if the flag is absent.
- `findActiveRun` filters runs by `state.sessionId`. The Stop hook reads `session_id` from its own stdin payload, so it always knows the current session.
- **Tag-on-touch**: any pre-existing run without a `sessionId` field gets adopted by the first session that calls `advance.ts set | advance | abort` on it.
- **Explicit-resume transfers ownership**: `/dp:dev-pipeline <abs-path>` and `/dp:dev-pipeline continue <name>` overwrite `state.sessionId` to the current session id before invoking the next skill, so cross-session and post-`/clear` resumes work normally.

We deliberately use `DP_SESSION_ID` rather than reusing `DEEP_SESSION_ID` from the deep-plan plugin — both values are identical (Claude Code's `session_id`), but the separate name keeps this plugin from depending on deep-plan being installed.

## Working on the plugin itself

Develop directly against the source tree at `~/projects/claude-dev-pipeline-plugin/`:

```bash
# Option A — start a session pointing Claude Code at the source tree:
cd <any-project>
claude --plugin-dir ~/projects/claude-dev-pipeline-plugin

# Option B — install the local clone as a plugin (persists across sessions):
/plugin install ~/projects/claude-dev-pipeline-plugin
```

Then in chat:

```
/dp:improve <free-text feedback about the plugin>
```

`dp:improve` will identify the right file, preview the diff, apply, bump `version` in `.claude-plugin/plugin.json`, and create a single-purpose git commit. It refuses to run against a marketplace cache install — fork and clone first.

### Publishing updates

**"Publishing" means making a new version installable through the plugin's _marketplace_ — it is NOT the same as `git push`.** `git push` (and `npm publish`) are only *transport*; the plugin becomes *published* when consumers can install/update it from a marketplace catalog. Keep that distinction in mind.

This repo is a **self-hosted GitHub marketplace** (`.claude-plugin/marketplace.json` + `.cursor-plugin/marketplace.json`), so the release flow is:

1. Make changes (manually or via `dp:improve`).
2. **Bump `version` in all four manifests in lockstep** — `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (top-level **and** `plugins[0].version`), `.cursor-plugin/plugin.json`, `.cursor-plugin/marketplace.json` (`metadata.version`). `dp:improve` does this automatically. Versions are **pinned**, so consumers receive an update only when this string changes — pushing commits without bumping it does nothing.
3. Push the catalog + source: `git push`.
4. Tag the release with the version-resolution convention (`dp--v<version>`, **not** a plain `v<version>`): from the repo root run `claude plugin tag --push`. It derives `dp--v<version>` from the manifest and pushes it. (Optional unless another plugin depends on this one, but it's the correct format; a hand-made `git tag v<version>` is the wrong shape for Claude Code's version resolver.)

End users then update via:

```
/plugin marketplace update claude-dev-pipeline-plugin
/reload-plugins
```

**Auto-update is off by default for third-party marketplaces** — consumers must enable it per-marketplace in `/plugin > Marketplaces`, or an org admin sets `"autoUpdate": true` on the `extraKnownMarketplaces` entry in managed settings. The publisher cannot force auto-update.

#### Non-git ways to publish (alternatives)

Git is only this repo's chosen transport. A Claude Code plugin can be published without git:

- **npm** — `npm publish` the plugin package, then reference it with a `{ "source": "npm", "package": "…" }` marketplace entry. Fetched via `npm install`; no git.
- **Org marketplace (claude.ai)** — Organization settings → Plugins → upload a plugin `.zip` (or GitHub-sync). Consumed by claude.ai chat + Cowork.
- **Anthropic community directory** — submit at `clau.de/plugin-directory-submission` (runs validation + safety screening) to be listed in the in-app `/plugin` Discover tab as `@claude-community`.

#### Local author install (how it runs on this machine)

On the author's machine the plugin is registered as a **`directory`-source marketplace** pointing at the working tree (see `~/.claude/plugins/known_marketplaces.json` → `"source": "directory"`) and installed as `dp@claude-dev-pipeline-plugin`. That's a non-git local install — run `/reload-plugins` to pick up edits with no push.

### Upgrading from v0.4.x to v0.5.0

v0.5.0 introduces session scoping (see "Session scoping" above). Two upgrade caveats:

- **SessionStart hooks fire only on session start.** After running `/plugin marketplace update` + `/reload-plugins` in an *existing* conversation, the new hook code is loaded but the SessionStart hook does NOT fire retroactively — so `DP_SESSION_ID` is not in the current conversation's context, and `process.env.DP_SESSION_ID` is also empty (the env-var write happens in the hook, which never ran for this session). Any `/dp:dev-pipeline` run started in this stale conversation will be created **without** a sessionId tag. To get the fix, **start a fresh Claude Code session in the project** before starting your next pipeline run.
- **Existing active runs from before the upgrade have no sessionId.** They will be adopted on first interaction (tag-on-touch). If two old sessions both reference such a run, only the first to interact with it claims it. If you have a stale `active: true` run you don't intend to resume, run `bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts abort <run-dir>` to mark it inert.

### Upgrading from v0.5.x to v0.6.0

v0.6.0 adds Cursor support and is additive — **no action needed for existing Claude Code users**. Run `/plugin marketplace update claude-dev-pipeline-plugin` + `/reload-plugins` and the existing `/dp:dev-pipeline` workflow keeps working.

Two new mechanisms ship under the hood:

- **`DP_PLUGIN_ROOT` env var** replaces `${CLAUDE_PLUGIN_ROOT}` in all skill bodies and the orchestrator command. The SessionStart hook on both platforms exports it. The same caveat as v0.5 applies: SessionStart hooks fire only on session start, so existing conversations need a fresh session before `${DP_PLUGIN_ROOT}` resolves in skill commands.
- **Split hook config files**. `hooks/hooks.json` (Claude Code, unchanged from v0.5) and new `hooks/cursor-hooks.json` (Cursor). Each platform reads only its own file via its respective manifest.

Cursor users follow the **Quick start — Cursor 2.6+** section above to add the new platform.

### Diagnostic logs

Every hook and `advance.ts` invocation appends a single NDJSON line to **`/tmp/dp-logs/<YYYY-MM-DD>.ndjson`** AND mirrors it to stderr. Logging is best-effort — failures inside the logger are silently swallowed so they never break a hook.

**Live in your IDE.** Each line goes to stderr prefixed with `[dp] {...}`. Claude Code's VSCode extension captures it in **Output → "Claude Code"**; Cursor captures it in **Output → "Cursor Agent"**. Pop the panel open and you see every dp hook fire in real time.

**Persistent file**:

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts logs
# prints: /tmp/dp-logs/2026-05-15.ndjson

tail -f $(bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts logs) | jq -c
```

What gets logged:

- **SessionStart hook** (`capture-session.ts`): platform detected, session id, plugin root, state dir resolved.
- **Stop hook** (`enforce-pipeline-progress.ts`): platform, run dir, gate decision (`pending-step` / `checks-not-passed` / `no-gate-needed`), step name.
- **`advance.ts` subcommands**: only failures, via the uncaught-exception handler. Successful invocations are silent to keep the file small.

`/tmp/dp-logs/` is single-machine, no per-project pollution, auto-cleaned on reboot.

### Upgrading from v0.6.x to v0.7.0

v0.7.0 fixes a Cursor-only bug where the state directory was hardcoded to `.claude/feature-pipeline/`. On Cursor, runs now live under `.cursor/feature-pipeline/` instead. Claude Code users are unaffected — state still lives at `.claude/feature-pipeline/`.

Three mechanisms ship together:

- **`DP_STATE_DIR` env var** is now exported by the SessionStart hook: `.claude` on Claude Code, `.cursor` on Cursor. All path resolution happens inside `advance.ts` which reads this var; skill bodies and the orchestrator no longer hardcode either prefix.
- **`advance.ts` now accepts slugs**, not full run-dir paths. Old signature: `advance.ts set <run-dir> <path> <value>`. New signature: `advance.ts set <slug> <path> <value>`. Absolute paths (e.g. for explicit-resume by path) are still accepted — the script detects path-style by the presence of `/` or `~`.
- **New `advance.ts runpath <slug>` subcommand** prints the project-relative run path (e.g. `.cursor/feature-pipeline/foo`) — use it whenever you need to construct a clickable markdown link.

**Migrating active runs from v0.6.0 on Cursor**: any active runs that were created under `.claude/feature-pipeline/` while running on Cursor are now orphaned (the new `findRun.ts` walks the platform-specific dir). To rescue them, manually `mv .claude/feature-pipeline/<run> .cursor/feature-pipeline/`. Claude Code runs need no migration.

**Same upgrade caveat as v0.5/v0.6**: SessionStart hooks fire only on session start. After `/plugin marketplace update` + `/reload-plugins`, existing conversations have an empty `${DP_STATE_DIR}` until the next fresh session. The script defaults to `.claude` when unset — safe on Claude Code, wrong on Cursor. Restart the Cursor session to pick up the new env var.

## File layout

```
claude-dev-pipeline-plugin/
├── .claude-plugin/                # Claude Code manifests
│   ├── plugin.json
│   └── marketplace.json
├── .cursor-plugin/                # Cursor manifests (v0.6.0+)
│   ├── plugin.json
│   └── marketplace.json
├── commands/
│   └── dev-pipeline.md            # orchestrator (used by both platforms)
├── hooks/
│   ├── hooks.json                 # Claude Code event config (PascalCase)
│   └── cursor-hooks.json          # Cursor event config (camelCase, v0.6.0+)
├── skills/                        # shared across platforms
│   ├── investigation/SKILL.md
│   ├── plan-proposal/SKILL.md
│   ├── plan/SKILL.md
│   ├── plan-improve/SKILL.md
│   ├── plan-improve-apply/SKILL.md
│   ├── plan-wrapup/SKILL.md
│   ├── implementation/SKILL.md
│   ├── codereview/SKILL.md
│   └── improve/SKILL.md
├── scripts/
│   ├── lib/{state.ts,findRun.ts,hookSession.ts,sessionArgs.ts,hookPlatform.ts}
│   ├── cli/{advance.ts,status.ts}
│   └── hooks/{capture-session.ts,enforce-pipeline-progress.ts}
└── README.md
```

## State schema

`<consumer-project>/.claude/feature-pipeline/<feature>/state.json`:

```json
{
  "name": "auth-rewrite",
  "createdAt": "...",
  "active": true,
  "autonomous": false,
  "currentStep": "plan",
  "steps": {
    "investigation":      { "status": "done", "artifact": "context.md" },
    "plan-proposal":      { "status": "done", "approvalMode": "yes" },
    "plan":               { "status": "running", "artifact": "plan.md" },
    "...":                "..."
  },
  "args": "rewrite auth to use refresh tokens"
}
```

## License

MIT

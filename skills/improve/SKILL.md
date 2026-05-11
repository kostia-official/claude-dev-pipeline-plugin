---
name: improve
description: Use when the user asks to improve, fix, tweak, or extend the dev-pipeline plugin itself (its skills, orchestrator, scripts, manifest). Edits this plugin's source tree, bumps version, and creates a git commit. Plugin authors only — refuses to run if the plugin is installed via marketplace cache.
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash(bun *)
  - Bash(git *)
  - Bash(realpath *)
  - AskUserQuestion
---

# dp:improve

Self-modifying meta-skill. Lets the plugin author iterate on this plugin from inside a Claude Code session: identify the right file, preview the edit, apply, bump version, commit.

## Inputs

- `$ARGUMENTS` — free-text feedback (e.g. "make `dp:plan-proposal` ask about scope before approach", "add a section to `dp:investigation` for external dependencies").
- `${CLAUDE_PLUGIN_ROOT}` — always set when this skill runs; points to the plugin source.

## Procedure

### 1. Resolve and validate the plugin source path

- Read `${CLAUDE_PLUGIN_ROOT}`.
- If the path contains `/.claude/plugins/cache/` → **REFUSE** with this exact message and stop:

  > `dp:improve` cannot run against a marketplace-installed plugin: `${CLAUDE_PLUGIN_ROOT}` is in the plugin cache, and any edits would be overwritten the next time the marketplace catalog is refreshed (`/plugin marketplace update <marketplace>` + `/reload-plugins`).
  >
  > To work on the plugin:
  >   1. Fork or clone `git@github.com:kostia-official/claude-dev-pipeline-plugin.git` to a local directory (e.g. `~/projects/claude-dev-pipeline-plugin/`).
  >   2. Either run Claude Code with `claude --plugin-dir <local-clone>`, or `/plugin install <local-clone>`.
  >   3. Re-run `/dp:improve <your feedback>`.

- Otherwise confirm with `git -C ${CLAUDE_PLUGIN_ROOT} rev-parse --show-toplevel` that the directory is a git repo. If not, refuse and tell the user the plugin source must be a git repo.
- Check `git -C ${CLAUDE_PLUGIN_ROOT} status --porcelain` for uncommitted changes inside the plugin tree. If any exist, REFUSE: tell the user to commit or stash those changes first so the auto-commit doesn't pull in unrelated work. Allow override only via explicit `AskUserQuestion` confirmation.

### 2. Understand the request

Parse `$ARGUMENTS`. If genuinely ambiguous (you can't tell what file or behavior to change), ask **one** clarifying `AskUserQuestion` — never more.

### 3. Identify target file(s)

Map intent to one of:

- `skills/<step>/SKILL.md` — for skill behavior changes.
- `commands/dev-pipeline.md` — for orchestrator changes (argument classification, hand-off rules).
- `scripts/lib/*.ts` — for state/findRun helper changes.
- `scripts/cli/*.ts` — for state CLI helper changes.
- `scripts/hooks/*.ts` — for hook behavior changes.
- `.claude-plugin/plugin.json` — for manifest changes (NB: version is bumped in step 6, not via this path).
- `.claude-plugin/marketplace.json` — for marketplace metadata.
- `README.md` — for documentation changes.

When multiple files plausibly match, list them with the suggested edit summary and ask `AskUserQuestion`: which to apply? Include "All of them" if appropriate.

### 4. Preview the diff

Read current file content. Draft the edit. Show the user a unified-diff-style preview in chat:

```
--- a/<path>
+++ b/<path>
@@ ... @@
-<removed line>
+<added line>
```

Then ask `AskUserQuestion`:
- **Apply** — proceed.
- **Modify (give more direction)** — capture user feedback, redraft, loop back.
- **Cancel** — stop, no changes made.

### 5. Apply the edit

Use `Edit` (or `Write` for new files).

### 6. Bump version

Read `version` from `.claude-plugin/plugin.json`. Default bump is **PATCH** (`X.Y.Z → X.Y.(Z+1)`).

If the change matches "substantive" heuristics, ask `AskUserQuestion` with options PATCH / MINOR / MAJOR:

- **MINOR**: added a new skill, added a new orchestrator capability, added a new state.json field that's optional.
- **MAJOR**: removed/renamed an existing skill, changed `state.json` schema in a non-additive way, changed a hook contract, changed the `/dp:dev-pipeline` argument classifier in an incompatible way.

Write the new version back into `.claude-plugin/plugin.json`. Also update `.claude-plugin/marketplace.json`'s `version` field to match.

### 7. Commit

Run:

```
git -C ${CLAUDE_PLUGIN_ROOT} add <list of files you actually modified>
git -C ${CLAUDE_PLUGIN_ROOT} commit -m "$(cat <<'EOF'
dp:improve — <one-line summary>

<original $ARGUMENTS, indented or quoted>
EOF
)"
```

**Do NOT include `Co-Authored-By: Claude` in the message** (per project rules).

Stage only the files you modified — never `git add .` or `git add -A`.

### 8. Do NOT push

Print to chat (verbatim — the user asked for this exact reminder block on every improve cycle):

> Committed locally on branch `<branch>`. Push when ready:
>
>     git push
>
> Then refresh the plugin in your session:
>
>     /plugin marketplace update claude-dev-pipeline-plugin
>     /reload-plugins
>
> (Other end users will run the same two commands after their next `git pull` — there is no auto-update.)

### 9. Live-reload notice

The change is also live in *this* session already (Claude Code watches plugin dirs). If anything looks off, run `/reload-plugins`.

## Guardrails (recap)

- Refuse when `${CLAUDE_PLUGIN_ROOT}` is under `~/.claude/plugins/cache/`.
- Refuse on dirty git tree inside the plugin (unless user explicitly overrides).
- Never edit files outside the plugin tree (no consumer-project files, no `~/.claude/` outside the plugin).
- Never auto-push.
- Never bump MAJOR without explicit confirmation.
- If the requested edit would touch `dp:improve`'s own SKILL.md or its dependencies, double-confirm with `AskUserQuestion` before writing — there is no recovery if it breaks itself in this session.

# Plan: cursor-port — Cursor-native distribution of the `dp` plugin

## Context

The `dp` plugin currently only runs in Claude Code. Cursor 2.5+ has its own plugin marketplace and a fully spec'd plugin model (skills, rules, agents, hooks, MCP servers, marketplace manifest at `.cursor-plugin/`) that overlaps with Claude Code's `.claude-plugin/` model. End users on Cursor cannot install `dp` today.

The goal is one repo, two distributions. The repo at `~/projects/claude-dev-pipeline-plugin` already ships the Claude Code version (v0.5.0). We add a parallel Cursor manifest set, port the two hook scripts to handle both platforms' stdin/stdout contracts, replace the Claude-Code-only `Skill(skill_name = "...")` chaining with Cursor's `stop`-hook `followup_message` mechanism, and propagate a unified `DP_PLUGIN_ROOT` env var via both platforms' session-start hooks so shared SKILL.md bodies (and the shared orchestrator at `commands/dev-pipeline.md`) call `bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts ...` once and run unchanged everywhere. The compound-engineering plugin (`EveryInc/compound-engineering-plugin`) proves multi-platform plugins work from one repo — they ship `.claude-plugin/`, `.codex-plugin/`, and `.cursor-plugin/` siblings at the per-plugin level. We follow the same pattern but with both manifests at the repo root (since `dp` is flat, not nested under `plugins/dp/`).

Success criteria:
- Claude Code v0.5.0 install flow is unchanged — existing users notice nothing different except a version bump.
- Cursor 2.6 user can run "Dashboard → Settings → Plugins → Team Marketplaces → Import GitHub URL" with `https://github.com/kostia-official/claude-dev-pipeline-plugin`, install `dp`, then type the orchestrator slash command (`/dev-pipeline <feature>`, or `/dp-dev-pipeline <feature>` depending on Cursor's `commands/`-to-slash mapping rules — verified during install testing) in Agent chat and have a full pipeline run end to end with `context.md` → `plan.md` → `review.md` → implementation → codereview, same as Claude Code.

## Approach

Dual manifest at repo root. `.claude-plugin/` and `.cursor-plugin/` coexist as siblings, each with its own `marketplace.json` and `plugin.json`. Both manifests reference the same shared `skills/`, `hooks/`, and `scripts/` directories. No restructure into a `plugins/dp/` subdirectory — the flat layout is preserved because both manifest formats support `pluginRoot: "."` (or its equivalent self-reference).

Platform-sniffing in the two hook scripts. `capture-session.ts` and `enforce-pipeline-progress.ts` already exist for Claude Code. They are extended to detect which platform invoked them by inspecting the stdin JSON: Cursor's payload includes `hook_event_name`, `cursor_version`, and `workspace_roots` fields that Claude Code never sends, while Claude Code's payload has fields like `transcript_path`. A small helper in `scripts/lib/hookPlatform.ts` exposes `detectPlatform(payload): "claude-code" | "cursor"` so both scripts share the same detection. The scripts then emit the matching output shape — `{hookSpecificOutput: {additionalContext, hookEventName}}` for Claude Code SessionStart; `{env, additional_context}` for Cursor sessionStart; `{decision: "block", reason}` for Claude Code Stop; `{followup_message}` for Cursor stop.

Plugin-root env var propagation. Cursor exposes no `CURSOR_PLUGIN_ROOT` env var, but skill bodies in this plugin invoke `bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts ...` — Claude-Code-specific. **Decision**: introduce a unified `DP_PLUGIN_ROOT` env var that both platforms' sessionStart hooks export. The hook script knows its own location via `import.meta.dir` (Bun built-in), resolves the plugin root by walking up to the directory containing `.claude-plugin/` and/or `.cursor-plugin/`, then returns it via the platform-appropriate channel: Claude Code via `hookSpecificOutput.additionalContext` (already used for `DP_SESSION_ID`) plus the `CLAUDE_ENV_FILE` `export` line; Cursor via the `env` field of the sessionStart response (which Cursor propagates to every subsequent hook in the session). All SKILL.md bodies and `commands/dev-pipeline.md` migrate from `${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts` to `${DP_PLUGIN_ROOT}/scripts/cli/advance.ts`. Single-source path, works on both platforms.

Separate hook config files per platform. **Decision**: ship `hooks/hooks.json` unchanged for Claude Code AND a new `hooks/cursor-hooks.json` for Cursor. The new Cursor file uses camelCase event names, flat `{command, loop_limit}` shape, `"version": 1` top-level key, relative paths (`./scripts/hooks/...`). The Cursor manifest at `.cursor-plugin/plugin.json` references it via `hooks: "./hooks/cursor-hooks.json"`. Two files chosen over a single dual-format file because: (a) Cursor's parser may reject unknown PascalCase event names; (b) Claude Code's parser may reject the camelCase event names or the `version` top-level key; (c) keeping each parser's input in a familiar shape eliminates the conjecture and the verification burden. `loop_limit: null` on Cursor's `stop` entry so the auto-prompt mechanism can chain through the 8-step pipeline without hitting the default cap of 5.

Skill renames are deliberately minimal. **Note: this is a deliberate reversal of the approved proposal's section 2 which said "Rename every skill in frontmatter from `name: investigation` to `name: dp-investigation`". Re-approved by the user during plan-improve-apply.** Skill directory names stay as today (`skills/investigation/`, `skills/plan/`, …) — renaming them would break the Claude Code distribution. The SKILL.md frontmatter `name:` field stays at the short form (`investigation`, `plan`, …). On Claude Code these surface as `/dp:investigation` etc. via the manifest namespace. On Cursor they surface as `/investigation`, `/plan`, … which carries a small risk of collision with other installed Cursor plugins. **Decided**: accept this risk for v0.6.0 because (a) the user-facing entry point is `/dp-dev-pipeline` (the orchestrator), which IS prefixed, and (b) the individual step skills are rarely invoked directly by users — they're invoked by the auto-prompt mechanism. **Collision verified**: by inspecting the 9 official Cursor plugins (`cursor/plugins` repo: continual-learning, cursor-team-kit, create-plugin, agent-compatibility, cli-for-agent, pr-review-canvas, docs-canvas, cursor-sdk, orchestrate) and the most popular cross-platform plugin (compound-engineering, which prefixes all skills `ce-*`), none ship a skill named `investigation`, `plan`, `plan-proposal`, `plan-improve`, `plan-improve-apply`, `plan-wrapup`, `implementation`, `codereview`, or `improve` as of this plan date. If a real-world collision surfaces post-release, we can add a `dp-` prefix in a follow-up release.

Orchestrator delivered via the existing `commands/dev-pipeline.md` on BOTH platforms. **Decision**: reuse the existing file. Cursor's plugin template ships a `commands/` directory, suggesting Cursor surfaces `commands/*.md` in the `/`-menu. The existing file is referenced from `.cursor-plugin/plugin.json` via the optional `commands: "./commands/"` field. If verification proves Cursor does NOT surface `commands/`, fall back to creating a `skills/dev-pipeline/SKILL.md` shadow with `name: dp-dev-pipeline` whose body mirrors the existing command file (deferred decision). The body of `commands/dev-pipeline.md` needs platform-aware edits: (a) replace `${CLAUDE_PLUGIN_ROOT}` with `${DP_PLUGIN_ROOT}` everywhere; (b) the "Step 4 — Invoke the matching skill IMMEDIATELY" section gets a Cursor branch explaining that on Cursor the stop-hook auto-prompt handles handoff, so the orchestrator simply needs to advance state.json and end its turn. Cross-platform single-source.

Stop hook on Cursor reads state.json and emits `followup_message`. After each step's body ends with `advance.ts advance`, control returns to Cursor, which fires the `stop` hook. The hook reads the new currentStep, looks up the mapping `{investigation → "/investigation", plan-proposal → "/plan-proposal", ...}`, and returns `{"followup_message": "Continue dp pipeline: invoke /<step> now."}`. Cursor auto-submits that as the next user turn and the matching skill triggers via slash-prefix auto-discovery. Loop cap is null so the 8 chained submissions all fire.

SessionStart on Cursor uses the richer `env` mechanism. The Cursor branch of `capture-session.ts` returns `{env: {DP_SESSION_ID: <session_id>, DP_PLUGIN_ROOT: <path>}, additional_context: "DP_SESSION_ID=<id>\nDP_PLUGIN_ROOT=<path>"}`. The `env` field is session-scoped and propagates to all subsequent hooks in that Cursor session — strictly better than Claude Code's `CLAUDE_ENV_FILE` append fallback. We keep `additional_context` too so the values show in the conversation context as a system reminder (matching Claude Code's behavior, which emits both vars in a single multi-line `additionalContext` block).

Version bump 0.5.0 → 0.6.0. MINOR per SemVer — additive platform support, no breaking change for Claude Code users. Both `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and the new `.cursor-plugin/plugin.json`, `.cursor-plugin/marketplace.json` carry `version: "0.6.0"`.

## File-by-file changes

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/.cursor-plugin/marketplace.json`
- **Change**: create
- **What**: Repo-root Cursor marketplace manifest. Contains `name: "claude-dev-pipeline-plugin"`, `owner` block matching `.claude-plugin/marketplace.json`, `metadata.version: "0.6.0"`, `metadata.pluginRoot: "."` (self-reference; the dp plugin lives at repo root, not under a `plugins/` subdirectory), and `plugins: [{name: "dp", source: ".", description: "..."}]`. Mirrors compound-engineering's `.cursor-plugin/marketplace.json` structure but with `pluginRoot: "."` instead of `pluginRoot: "plugins"`.
- **Why**: Cursor's marketplace discovery scans this file at the repo root. Without it, `/add-plugin` and 2.6 Team Marketplaces import cannot find the plugin.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/.cursor-plugin/plugin.json`
- **Change**: create
- **What**: Per-plugin Cursor manifest. Fields: `name: "dp"`, `displayName: "Dev Pipeline"`, `version: "0.6.0"`, `description: "Feature-planning pipeline for Cursor: investigation → proposal → plan → review → implementation → codereview, with persistent state and a stop-hook workflow gate."`, `author`, `homepage`, `repository`, `license`, `keywords`, `category: "developer-tools"`, plus explicit component paths: `skills: "./skills/"`, `commands: "./commands/"`, `hooks: "./hooks/cursor-hooks.json"`. Omits `rules`, `agents`, `mcpServers` — we don't ship those.
- **Why**: Required manifest for Cursor. `commands: "./commands/"` lets the existing `commands/dev-pipeline.md` surface as `/dev-pipeline` (or `/dp-dev-pipeline` depending on Cursor's command-naming rules). `hooks` points to the Cursor-only config file so Cursor's parser never sees the Claude Code PascalCase entries.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/commands/dev-pipeline.md`
- **Change**: modify (significant)
- **What**: Cross-platform reuse — single orchestrator file for both Claude Code AND Cursor. Edits: (a) replace every `${CLAUDE_PLUGIN_ROOT}` occurrence with `${DP_PLUGIN_ROOT}` (works on both platforms after the sessionStart hook propagation change); (b) the "Step 4 — Invoke the matching skill IMMEDIATELY" section gains a Cursor branch: "On Claude Code: invoke `Skill(skill_name = "dp:<step>")` in this same turn. On Cursor: end your turn after the announce block — the plugin's `stop` hook will return a `followup_message` that auto-submits `/<step>` as the next turn, triggering the matching skill via slash-prefix auto-discovery."; (c) remove the explicit "MUST happen in this same turn" line and replace with platform-aware version.
- **Why**: Single source of truth for orchestration logic. Cursor's plugin template suggests `commands/` is surfaced in the `/`-menu, so the file works as-is on Cursor (with the env-var and chain-mechanism edits). Saves us from duplicating ~150 lines into a sibling skill.

**Fallback if Cursor doesn't surface `commands/`**: create `skills/dev-pipeline/SKILL.md` with frontmatter `name: dp-dev-pipeline` whose body re-references the same content (or copies it). This decision is deferred to verification — if the install test in Cursor shows `/dp-dev-pipeline` (or `/dev-pipeline`) doesn't appear in the slash menu, ship the skill shadow in a follow-up.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/hookPlatform.ts`
- **Change**: create
- **What**: New shared helper exporting `detectPlatform(payload: unknown): "claude-code" | "cursor" | "unknown"`. Logic: if `payload` has `cursor_version` or `hook_event_name` (camelCase) or `workspace_roots` fields → `"cursor"`. If `payload` has `transcript_path` or `hook_event_name` (PascalCase) → `"claude-code"`. Otherwise → `"unknown"`. Also exports `CURSOR_LOOP_NEXT_PROMPT(step: string): string` returning `"Continue dp pipeline: invoke /${step} now."` so both the stop hook and any future caller use one canonical phrasing.
- **Why**: Hook scripts need to branch on platform. Centralizing the detection prevents drift if Cursor's payload schema evolves.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/hooks/capture-session.ts`
- **Change**: modify
- **What**: Add platform branching AND `DP_PLUGIN_ROOT` propagation. After reading `sessionId` from stdin (existing logic, reused as-is), compute the plugin root path: `pluginRoot = path.resolve(import.meta.dir, "../..")` (the hook script lives at `scripts/hooks/`; two levels up is the plugin root). Detect platform via `detectPlatform`. For `"claude-code"`: emit `{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: "DP_SESSION_ID=<id>\nDP_PLUGIN_ROOT=<path>"}}` (both vars in the same context line, newline-separated — Claude Code's existing parser already handles multi-line additionalContext); continue with the existing `CLAUDE_ENV_FILE` `export` fallback for both vars. For `"cursor"`: emit `{env: {DP_SESSION_ID: <id>, DP_PLUGIN_ROOT: <path>}, additional_context: "DP_SESSION_ID=<id>\nDP_PLUGIN_ROOT=<path>"}` and skip the env-file fallback (Cursor's `env` field is enough — propagates to all subsequent hooks). For `"unknown"`: exit 0 silently.
- **Why**: Cursor's sessionStart output schema differs from Claude Code's. Same hook handles both by sniffing the input. The `DP_PLUGIN_ROOT` propagation makes all skill bodies cross-platform via a single `${DP_PLUGIN_ROOT}` env var.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/hooks/enforce-pipeline-progress.ts`
- **Change**: modify
- **What**: Add platform branching. Existing logic (read session_id, walk to active state.json, detect pending currentStep) stays. The output emission diverges by platform. For `"claude-code"`: keep the existing `{decision: "block", reason}` shape. For `"cursor"`: emit `{followup_message: "Continue dp pipeline: invoke /<currentStep> now."}` using `CURSOR_LOOP_NEXT_PROMPT(currentStep)` from `hookPlatform.ts`. The implementation-checks-passed gate also adapts: Claude Code blocks with the existing corrective message; Cursor returns `followup_message: "dp:implementation has not recorded a successful typecheck + lint pass. Run the project's typecheck and lint, fix any errors, then mark the gate: bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <runDir> steps.implementation.checksPassed true"`. The Cursor branch is observational — Cursor can't actually block — but the auto-prompt still nudges the model.
- **Why**: Same hook is the workflow gate on both platforms but with weaker enforcement on Cursor.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/hookSession.ts`
- **Change**: no change (verify reusable)
- **What**: `readHookSessionId()` already reads top-level `session_id` from stdin JSON. Cursor's payload uses the same field name. Verified reusable.
- **Why**: Confirming reuse, not modifying.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/state.ts`, `scripts/lib/findRun.ts`, `scripts/lib/sessionArgs.ts`, `scripts/cli/advance.ts`, `scripts/cli/status.ts`
- **Change**: no change
- **What**: Pure Bun TypeScript with no harness-specific dependencies. State schema, file paths, and CLI behavior are identical on both platforms.
- **Why**: 100% reuse — listed here so the plan acknowledges they were inspected and confirmed unchanged.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/hooks/hooks.json`
- **Change**: no change
- **What**: Existing Claude Code hook config stays exactly as it is today. PascalCase event names (`SessionStart`, `Stop`), nested `{hooks: [{type: "command", command: "bun ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/capture-session.ts"}]}` shape. Claude Code reads this file via the `.claude-plugin/` manifest's implicit hook discovery.
- **Why**: Splitting into two files means Claude Code's file doesn't need to change — preserve existing v0.5.0 behavior verbatim.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/hooks/cursor-hooks.json`
- **Change**: create
- **What**: Cursor-only hook config. Structure: `{"version": 1, "hooks": {"sessionStart": [{"command": "bun ./scripts/hooks/capture-session.ts"}], "stop": [{"command": "bun ./scripts/hooks/enforce-pipeline-progress.ts", "loop_limit": null}]}}`. Relative paths resolve from the plugin root (per `cursor/plugin-template/plugins/starter-advanced/hooks/hooks.json` precedent). `loop_limit: null` removes the auto-prompt cap so 8-step chains complete. The Cursor manifest at `.cursor-plugin/plugin.json` points to this file via `hooks: "./hooks/cursor-hooks.json"`.
- **Why**: Two files instead of one dual-format file. Each parser sees only its own format — zero risk of either platform rejecting unknown keys. Trades one extra file for safety and zero conjecture.

### Existing skill bodies — `skills/{investigation,plan-proposal,plan,plan-improve,plan-improve-apply,plan-wrapup,implementation,codereview}/SKILL.md`
- **Change**: modify (per skill: three edits)
- **What**: For each of the 8 step skills:
  (1) Replace every `bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts ...` with `bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts ...`. This unifies the path env var across both platforms (Claude Code's SessionStart and Cursor's sessionStart both export DP_PLUGIN_ROOT).
  (2) The "Hand off — INVOKE THE NEXT SKILL, do not text-stop" section currently says `Skill(skill_name = "dp:plan-proposal")` etc. Reword to be platform-aware: "On Claude Code: your very next action must be `Skill(skill_name = "dp:<next-step>")`. On Cursor: advance state.json then end your turn — the plugin's stop hook will auto-prompt the next skill via `followup_message`."
  (3) The "Plugin's Stop hook will block your turn" line is reworded to "The plugin's Stop hook gates progression on Claude Code (hard block) or auto-prompts the next skill on Cursor (soft auto-submit). Either way, advancing state.json correctly is mandatory."
  
  No frontmatter changes — `name:` field stays short (per Issue #3 user re-approval). No `disable-model-invocation` added (per Issue #5 user decision to leave it off).
- **Why**: Skills must run on both platforms. `${CLAUDE_PLUGIN_ROOT}` won't resolve on Cursor; `${DP_PLUGIN_ROOT}` works on both. The Skill tool doesn't exist on Cursor; the model would error trying to invoke it.

<!-- commands/dev-pipeline.md edits are described in the Approach section above and in the dedicated entry earlier in this file-by-file list (cross-platform single-source orchestrator). No duplicate entry needed. -->

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/skills/improve/SKILL.md`
- **Change**: modify
- **What**: Update the version-bump section to keep all 4 manifest version fields in lockstep. Currently `dp:improve` bumps `.claude-plugin/plugin.json` only. After this port we have 4 versioned files: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (top-level + plugin entry), `.cursor-plugin/plugin.json`, `.cursor-plugin/marketplace.json` (top-level + plugin entry). The skill body must read all four, bump together, fail loudly if they were already out of sync (drift detection). Also update the cache-path guard to also reject `~/.cursor/plugins/cache/` paths (Cursor's plugin cache; same self-modification risk as `~/.claude/plugins/cache/`).
- **Why**: Without this, the next `/dp:improve` invocation creates version drift between platforms.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/.claude-plugin/plugin.json`
- **Change**: modify
- **What**: Bump `version` from `"0.5.0"` to `"0.6.0"`.
- **Why**: Claude Code's marketplace cache key. Without a bump, end users don't pull the new version.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/.claude-plugin/marketplace.json`
- **Change**: modify
- **What**: Bump `version` (top-level AND the `dp` plugin entry's `version`) from `"0.5.0"` to `"0.6.0"`.
- **Why**: Same reason — cache key.

### `/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/README.md`
- **Change**: modify
- **What**: Add a new top-level section "## Cursor support" between the existing "Installation" and "Upgrading" sections. Subsections: (1) "Install in Cursor 2.6+" with concrete steps (Dashboard → Settings → Plugins → Team Marketplaces → Import → paste GitHub URL → select dp). (2) "Differences from Claude Code" — note that step chaining is soft (auto-prompt, not hard-block), that loop cap is configurable, and that individual step skills surface without the `dp-` prefix in Cursor's `/` menu. (3) Under the existing "Upgrading" section, **add a new subsection "Upgrading from v0.5.x to v0.6.0" BELOW the existing "Upgrading from v0.4.x to v0.5.0" subsection**. Keep the v0.4-to-v0.5 subsection unchanged as historical context. The new subsection notes: v0.6.0 is additive — no action needed for Claude Code users; Cursor users follow the install steps above to add the new platform.
- **Why**: End users need to know Cursor is supported and how to install.

## Reuse & extraction

### Existing code being reused

- `readHookSessionId` at [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/hookSession.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/hookSession.ts) → used by both the modified `capture-session.ts` and `enforce-pipeline-progress.ts` on both platforms. Cursor's stdin payload uses the same `session_id` field, no fork needed.
- `SESSION_ENV_VAR` constant at the same path → used by both platforms' SessionStart branches.
- `resolveSessionIdFromEnv` at the same path → used as fallback in `enforce-pipeline-progress.ts` when stdin parse fails on either platform.
- `findActiveRun` at [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/findRun.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/findRun.ts) → called from the modified `enforce-pipeline-progress.ts`. Walks `<cwd>/.claude/feature-pipeline/*/state.json` and filters by session id. Works unchanged on Cursor — `process.cwd()` resolves to the project root in both harnesses.
- State helpers (`readState`, `writeState`, `formatStateSummary`, `nextStep`, `STEP_ORDER`) at [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/state.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/state.ts) → used by every skill body's `advance.ts` invocation. Format is platform-independent.
- `extractSessionFlag` at [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/sessionArgs.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/sessionArgs.ts) → used by `advance.ts` and `status.ts`. Same on both platforms.
- The 8 step SKILL.md bodies → reused with the two-edit-per-skill platform-awareness tweak described above. ~95% body content stays.

### One-time-used code being extracted into a common component

- Platform detection logic (the rule "Cursor payload has `cursor_version` / `hook_event_name` (camelCase) / `workspace_roots`; Claude Code payload has `transcript_path` / `hook_event_name` (PascalCase)") would otherwise be duplicated across `capture-session.ts` and `enforce-pipeline-progress.ts`. Extract to `scripts/lib/hookPlatform.ts` (new file under the existing `lib/`) so both hook scripts call the same function. Reason: avoid divergence if Cursor's payload schema changes.
- `CURSOR_LOOP_NEXT_PROMPT(step)` formatter — currently no caller exists, but `enforce-pipeline-progress.ts` will use it, and `dp:improve`'s future "test the auto-prompt phrasing" check might use it too. Extract to `hookPlatform.ts` so the prompt phrasing has one source of truth.

## Verification

End-to-end verification covers both platforms and the cross-platform invariants.

### Claude Code (regression — must still work)
1. `claude plugin marketplace update claude-dev-pipeline-plugin` after pushing v0.6.0.
2. `/reload-plugins` in a Claude Code session.
3. Confirm `claude plugin list | grep dp` shows `dp@0.6.0`.
4. In a scratch project, run `/dp:dev-pipeline hello-world`. Confirm:
   - `.claude/feature-pipeline/hello-world/state.json` created with `sessionId` populated (proves SessionStart still fires on Claude Code).
   - `dp:investigation` skill auto-invokes via the existing Skill tool (proves the modified SKILL.md body still works on Claude Code).
   - Pipeline progresses through all 8 steps with no error.
5. Mid-pipeline, attempt to text-stop. Confirm the Stop hook emits `{decision: "block"}` (proves Claude Code branch of `enforce-pipeline-progress.ts` is intact).

### Cursor 2.6 (new)
1. In Cursor: Dashboard → Settings → Plugins → Team Marketplaces → Import → paste `https://github.com/kostia-official/claude-dev-pipeline-plugin` → review parsed plugins → install `dp`.
2. Restart Cursor (Cursor docs note that plugin install may require restart).
3. Open a project, start Cursor Agent chat, type `/` and confirm the orchestrator appears in the slash menu. Note the exact slash name Cursor uses (likely `/dev-pipeline` or `/dp-dev-pipeline`). **If neither appears, the `commands/`-to-slash mapping isn't working → trigger the fallback** described in the `commands/dev-pipeline.md` entry (create `skills/dev-pipeline/SKILL.md`).
4. Run the orchestrator with `hello-cursor` as the feature description. Confirm:
   - `.claude/feature-pipeline/hello-cursor/state.json` is created.
   - `sessionId` field is populated (proves Cursor's sessionStart branch of `capture-session.ts` returned the right `env: {DP_SESSION_ID, DP_PLUGIN_ROOT}` shape and propagation worked).
   - `DP_PLUGIN_ROOT` is visible in the session's env (verify by adding a temporary `echo $DP_PLUGIN_ROOT` line to one of the SKILL.md bodies before testing, or by inspecting the Cursor session's exported env).
   - The orchestrator body advances state to `investigation` and ends its turn (no `Skill(...)` call attempted).
   - The stop hook fires, returns `{followup_message: "Continue dp pipeline: invoke /investigation now."}`, Cursor auto-submits it, and the `investigation` skill triggers.
   - Pipeline progresses through all 8 steps via auto-prompt chaining. With `loop_limit: null`, no truncation.
5. Verify in the run directory that all artifacts (`context.md`, `plan.md`, `review.md`) were written.

### Cross-platform (edge case)
1. Run two concurrent Cursor sessions in the same project, each starting a different pipeline (run the Cursor orchestrator with `alpha` and `beta` features). Confirm sessions don't cross-talk — each session's stop hook only auto-prompts for its own active run (proves session filtering via DP_SESSION_ID works on Cursor, same as on Claude Code).
2. **Mixed-harness isolation**: open the same project in both Claude Code AND Cursor simultaneously. Start a pipeline in Claude Code (`/dp:dev-pipeline gamma`). Start a different pipeline in Cursor (run the Cursor orchestrator with `delta`). Confirm neither session's Stop/stop hook fires on the other's active run. Specifically: a text-stop in Claude Code's session should only consider state.json files whose `sessionId` matches the Claude Code session id; a stop event in Cursor's session should only consider state.json files whose `sessionId` matches the Cursor session id. (This is the realistic worst case — a user has both harnesses open and runs a pipeline in each.)
3. Force the implementation step's `checksPassed` gate to fail (delete the gate flag mid-run). Confirm Claude Code emits `{decision: "block"}` and the model is forced to retry. Confirm Cursor emits `{followup_message: "checks haven't passed, run typecheck + lint..."}` and the model is auto-prompted to retry.

### Tooling sanity
1. `bun run typecheck` inside `scripts/` passes after all edits.
2. JSON parse BOTH `hooks/hooks.json` (Claude Code, unchanged) AND `hooks/cursor-hooks.json` (new) — confirm valid JSON with correct event-name conventions per file.
3. Manual install path: `claude --plugin-dir ~/projects/claude-dev-pipeline-plugin` → still works (Claude Code).
4. Manual install path: copy plugin folder into Cursor's plugin source dir → still works (Cursor; verify by Cursor docs' local-development pattern if available).

## Out of scope (intentional)

- **`mcp.json`**: Cursor plugin template ships `mcp.json` at the plugin root for MCP server definitions. We don't ship MCP servers — explicitly NOT creating this file. If a future version adds MCP integrations, that's a separate scope.
- Codex, Gemini CLI, Pi, OpenCode, Kiro, Droid, Qwen — porting to other platforms. Each would need its own manifest dir and hook-script branch. Defer to follow-up versions.
- Submitting `dp` to Cursor's official curated marketplace at `cursor.com/marketplace`. We use Cursor 2.6's Team Marketplace import flow instead.
- A dedicated `claude-to-cursor` converter contributed back to `@every-env/compound-plugin`. Worth considering long-term but adds maintenance surface.
- Renaming skill directories from `investigation/` to `dp-investigation/`. Would break Claude Code's `/dp:investigation` slash, requires a major version bump. Accept the small risk of slash collision on Cursor for v0.6.0.
- Creating a separate `skills/dev-pipeline/SKILL.md` shadow of the orchestrator. We reuse `commands/dev-pipeline.md` on both platforms (per Issue #6 user decision). If Cursor's `commands/`-to-slash mapping turns out not to work, this becomes a follow-up release.
- Test fixtures for the platform detection helper. The logic is small (5 lines), tested manually during verification. Adding a test runner adds infrastructure we don't currently have in this repo.
- Cursor's prompt-type hooks (`"type": "prompt"`). Could upgrade the stop hook to an LLM-evaluated gate but adds dependency on Cursor's prompt-hook stability. Stick with command-type for v0.6.0.

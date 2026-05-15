# Context: cursor-port — Cursor-native version of the `dp` plugin

## Feature explanation

Ship a Cursor-native distribution of the `dp` (dev-pipeline) plugin so the same feature-planning workflow that today only runs in Claude Code becomes installable in Cursor 2.5+ via Cursor's marketplace (`/add-plugin claude-dev-pipeline-plugin`, or Cursor 2.6 Team Marketplaces by GitHub URL import).

User-visible behavior in Cursor must match Claude Code as closely as Cursor's primitives allow:

- User types `/dp-dev-pipeline <feature>` in Cursor Agent chat → pipeline initializes, state.json is written under `<cwd>/.claude/feature-pipeline/<slug>/`, the investigation skill is invoked.
- Pipeline progresses step-by-step: investigation → plan-proposal → plan → plan-improve → plan-improve-apply → plan-wrapup → implementation → codereview. Each step writes its artifact, then the agent is auto-prompted to invoke the next step (via the `stop` hook's `followup_message` mechanism, since Cursor has no `Skill` tool).
- Per-session isolation: Cursor's `sessionStart` hook captures `session_id` into a session-scoped env var `DP_SESSION_ID`. Subsequent hooks filter `findActiveRun` by it so concurrent Cursor sessions in the same project never block each other.
- The plugin coexists with the existing Claude Code distribution in the same repo (`~/projects/claude-dev-pipeline-plugin`). One git source, two manifests, shared scripts and skills.

What's deliberately accepted as lost vs Claude Code:
- **Hard gate replaced by soft auto-prompt.** Cursor's `stop` hook cannot block agent completion — it can only auto-submit a `followup_message` as the next user turn. The model can theoretically ignore the prompt and the pipeline could derail. Default loop cap of 5 must be raised to allow 8+ pipeline steps to chain.
- **Cross-skill `Skill(skill_name = "dp:codereview")` chaining is gone.** Cursor has no programmatic skill-invocation primitive. Substitute: each step's SKILL.md ends by writing the next currentStep; the plugin-wide `stop` hook reads state.json and returns `{"followup_message": "Continue the dp pipeline: invoke /dp-<next-step> now."}` which Cursor auto-submits → the matching skill auto-triggers via slash-prefix.
- **Flat skill namespace.** Cursor's `/` menu lists skills by simple name (no plugin-prefix scoping like Claude Code's `/dp:investigation`). Every skill's frontmatter `name:` must be prefixed manually (`dp-investigation`, `dp-plan`, …) to avoid collisions with other Cursor plugins.

## Related files

### Entry points
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/.claude-plugin/plugin.json](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/.claude-plugin/plugin.json) — current Claude Code manifest (name: `dp`, version: 0.5.0).
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/.claude-plugin/marketplace.json](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/.claude-plugin/marketplace.json) — Claude Code marketplace self-referencing source `"./"`.
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/commands/dev-pipeline.md](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/commands/dev-pipeline.md) — `/dp:dev-pipeline` orchestrator slash command. **Cursor has no user-facing `commands/` equivalent in practice — must be ported to a skill (`dp-dev-pipeline`) whose description triggers it as the entry point.**

### Manifests to add (Cursor side)
- `~/projects/claude-dev-pipeline-plugin/.cursor-plugin/marketplace.json` (NEW) — repo-root multi-plugin manifest, `pluginRoot: "."` so the same flat layout is reused.
- `~/projects/claude-dev-pipeline-plugin/.cursor-plugin/plugin.json` (NEW) — per-plugin Cursor manifest, points to `skills/`, declares `hooks/hooks.json`.

### Hooks (to be ported)
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/hooks/hooks.json](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/hooks/hooks.json) — current Claude Code hook config: `SessionStart` + `Stop` (blocking) on `*`. **Cursor uses lowercase camelCase event names: `sessionStart`, `stop`. Must be added alongside Claude's PascalCase entries in the same file — or split into a `.cursor-plugin/`-scoped hooks file. Tradeoff covered in plan.**
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/hooks/capture-session.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/hooks/capture-session.ts) — current SessionStart handler. Reads `session_id` from stdin via `readHookSessionId()`. Returns `hookSpecificOutput.additionalContext` (Claude Code format). **Cursor expects `{env: {DP_SESSION_ID: <id>}, additional_context: "..."}` shape.** Either branch by checking which event-name field is present, or ship a separate Cursor-specific handler.
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/hooks/enforce-pipeline-progress.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/hooks/enforce-pipeline-progress.ts) — current Stop handler. Emits `{decision: "block", reason: ...}` (Claude Code format) when `steps[currentStep].status === "pending"`. **Cursor expects `{followup_message: "..."}` for the auto-prompt mechanism. Different shape, different semantics (auto-submit vs block).** Either branch on the incoming stdin shape, or ship a Cursor-specific handler.

### Library code (fully reusable)
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/hookSession.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/hookSession.ts) — `readHookSessionId()`, `SESSION_ENV_VAR`. Cursor's hook payload also has top-level `session_id`. Reusable as-is.
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/state.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/state.ts) — state.json read/write. Reusable as-is.
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/findRun.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/findRun.ts) — `findActiveRun(cwd, sessionId?)`. Reusable as-is; the session filter mechanism is identical.
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/sessionArgs.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/lib/sessionArgs.ts) — `extractSessionFlag` helper. Reusable as-is.
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/cli/advance.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/cli/advance.ts) — state machine driver (`init`/`set`/`advance`/`abort`/`get`/`status`). Reusable as-is. Skill bodies on both Cursor and Claude Code call the same Bun script.
- [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/cli/status.ts](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/scripts/cli/status.ts) — status reader. Reusable as-is.

### Skills (8 step skills + improve)
All under [/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/skills/](/Users/kostiantynzvonilov/projects/claude-dev-pipeline-plugin/skills/):
- `investigation/SKILL.md`, `plan-proposal/SKILL.md`, `plan/SKILL.md`, `plan-improve/SKILL.md`, `plan-improve-apply/SKILL.md`, `plan-wrapup/SKILL.md`, `implementation/SKILL.md`, `codereview/SKILL.md`, `improve/SKILL.md`.

The skill bodies are 90%+ portable — same procedure, same advance.ts calls, same artifacts. Three sections require Cursor-specific edits in each skill:
1. `name:` frontmatter → prefix `dp-` (e.g. `name: dp-investigation`) so the flat `/` menu doesn't collide.
2. The "Hand off — INVOKE THE NEXT SKILL" section currently says `Skill(skill_name = "dp:plan-proposal")`. On Cursor that tool doesn't exist; the skill body becomes "advance the state; the plugin's stop hook will auto-prompt the next step". The text needs to be platform-conditional (or simply weakened to "advance, then end the turn — stop hook handles the rest" which works on both platforms).
3. `disable-model-invocation: true` — Cursor docs confirm this frontmatter field exists; behavior is "only included when invoked manually via `/skill-name`". Same semantics as Claude Code, so this stays unchanged.

### Compound-engineering precedent (reference)
- `EveryInc/compound-engineering-plugin` ships `plugins/compound-engineering/{.claude-plugin,.codex-plugin,.cursor-plugin}/plugin.json` — three sibling manifest dirs, same `skills/` and `agents/`. Proves multi-platform plugins can coexist in one repo. Repo also has `.cursor-plugin/marketplace.json` AND `.claude-plugin/marketplace.json` at the repo root. But: compound-engineering ships **no live hooks** — only test fixtures. Their plugin is pure skills+agents (declarative), so they sidestep the hook-port problem entirely. We can't.

### Cursor docs (read once)
- [Plugins Reference](https://cursor.com/docs/plugins/building) — manifest fields, directory layout, marketplace.json schema.
- [Hooks](https://cursor.com/docs/hooks) — full event list, JSON stdin/stdout contracts, `loop_limit` config for stop hook.
- [Agent Skills](https://cursor.com/docs/context/skills) — SKILL.md frontmatter, `disable-model-invocation`, manual `/skill-name` invocation.

## Existing code worth reusing

All of these run unchanged on both platforms because they're plain Bun TypeScript that doesn't depend on harness-specific globals:

- `scripts/lib/hookSession.ts` — `readHookSessionId()` reads `session_id` from stdin JSON. Cursor's hook payload uses the identical field name. **Reuse 100%.**
- `scripts/lib/state.ts` — state.json schema + read/write/advance/format helpers. **Reuse 100%.**
- `scripts/lib/findRun.ts` — walks up from cwd looking for `.claude/feature-pipeline/*/state.json`, filters by `currentSessionId` when passed. **Reuse 100%.**
- `scripts/lib/sessionArgs.ts` — `extractSessionFlag` for skill bodies. **Reuse 100%.**
- `scripts/cli/advance.ts` and `scripts/cli/status.ts` — same Bun scripts called from skill bodies on both platforms. **Reuse 100%.**
- The 9 SKILL.md bodies — content is 90%+ shared. We can either (a) duplicate them under a Cursor-specific dir with three edits, or (b) keep one set under `skills/` and reference from both `.claude-plugin/` and `.cursor-plugin/` manifests, with the small per-platform divergences expressed as inline "On Claude Code do X; on Cursor do Y" prose blocks. Compound-engineering uses approach (b) with one shared `skills/` dir referenced by all three manifests.

## Risks & unknowns

1. **Stop hook auto-prompt is observational, not enforcing.** Cursor's `stop` hook cannot block agent completion. The `followup_message` it returns auto-submits as the next user turn, but the model can ignore it (refuse to invoke the next skill). On Claude Code our `decision: "block"` is a hard gate — the model literally cannot end its turn. This is the single biggest semantic loss. Plan needs an explicit fallback: print the auto-prompt content prominently so even if the loop breaks the user can manually type `/dp-<step>` to recover.

2. **Cursor `loop_limit` default of 5 is too low for an 8-step pipeline.** Must be set to `null` (no cap) or ≥20 in `hooks/hooks.json`. **Open question: is `loop_limit` set per-hook entry in `hooks.json`, or globally somewhere else?** Cursor docs say "configurable via `loop_limit`" but the exact JSON path isn't clear from the spec read in this session. Plan step should verify against the Cursor docs or a working example before shipping.

3. **`commands/` directory is documented but unused.** Cursor's plugin spec lists `commands/` as a primitive, but none of Cursor's 9 official plugins use it, and the docs describe commands as "agent-executable actions" — not user-facing slash commands. The user-facing slash command in Cursor is invoked from `skills/<name>/SKILL.md` via the auto-discovered `/<name>` form. So our `commands/dev-pipeline.md` orchestrator must become a skill `dp-dev-pipeline` (or equivalent). **Open question: does Cursor actually surface `commands/*.md` in the `/` menu, or only `skills/`?** If `commands/` is invisible to users, we drop it entirely on the Cursor side and use a skill instead.

4. **Manifest coexistence — can `.claude-plugin/` and `.cursor-plugin/` live next to each other at repo root, sharing `skills/`, `hooks/`, `scripts/`?** Compound-engineering proves yes when both manifest dirs are at `plugins/compound-engineering/` (nested). At the **repo root** they also have both `.claude-plugin/marketplace.json` AND `.cursor-plugin/marketplace.json`. We follow the same pattern. Should be safe.

5. **Hook file format clash.** Claude Code's `hooks/hooks.json` uses PascalCase event names (`SessionStart`, `Stop`) and `decision: "block"` output shape. Cursor's uses lowercase camelCase (`sessionStart`, `stop`) and `followup_message`. Two options: (a) one file, both event-name conventions co-exist (Claude reads the PascalCase entries, Cursor reads the camelCase ones, each ignores what it doesn't recognize); (b) two separate hook files, each scoped under its respective manifest. **Need to verify (a) works** — i.e. that Cursor silently ignores unknown event names like `SessionStart` and that Claude Code silently ignores `sessionStart`. If either fails-closed, we must use (b).

6. **Single hook script handling two formats.** Our `enforce-pipeline-progress.ts` currently outputs `{decision: "block", reason}`. To serve Cursor it must output `{followup_message}`. Options: (a) one script, sniff which platform by inspecting stdin (Cursor includes `hook_event_name`, `cursor_version`, `workspace_roots` fields not present in Claude Code); (b) two scripts, one per platform, with the platform-detection logic at the dispatch level (different `hooks.json` entries point to different scripts). (b) is cleaner; (a) is DRYer. Plan to discuss.

7. **`prompt`-type hooks** — Cursor supports hooks of `"type": "prompt"` that run an LLM-evaluated check instead of a command. We don't need this for the port, but worth noting that the Cursor side could later upgrade enforcement by phrasing the gate as a prompt-evaluated check, since command hooks can't block stop.

8. **`disable-model-invocation` on Cursor.** Docs confirm it exists with semantics matching Claude Code: skill only loads when invoked manually via `/skill-name`. We currently set this on all 9 skills (or did at one point; current SKILL.md files dropped it during the session-scoped-stop-hook run since the Skill tool stopped working with it set). **Verify current state of frontmatter across skills/** before deciding whether to set it on the Cursor side.

9. **Will Cursor install our plugin from the existing repo URL `kostia-official/claude-dev-pipeline-plugin`?** Cursor 2.5 `/add-plugin` only works for plugins listed in Cursor's curated marketplace (which we're not). Cursor 2.6 Team Marketplaces accepts arbitrary GitHub URLs via Dashboard → Settings → Plugins → Import. End-user install instructions in README must reflect this.

10. **`subagentStart` / `subagentStop` events.** Cursor exposes hooks for subagent dispatch. We don't currently spawn subagents in `dp`, but `dp:plan-improve` uses Claude Code's Task tool indirectly. On Cursor that becomes the Task subagent flow. No action needed in v1 of the port, but worth flagging that subagent-based parallelization gets richer hook visibility on Cursor.

11. **Cross-platform testing**. We can install both Claude Code and Cursor versions side-by-side from the same repo, but verifying both work end-to-end requires running the same hello-world feature pipeline in both harnesses. Plan step must include a verification matrix.

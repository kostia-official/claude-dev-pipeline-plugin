# Context: session-scoped Stop hook

## Feature explanation

The dp plugin's plugin-wide Stop hook (`enforce-pipeline-progress.ts`) is supposed to enforce pipeline progression for the **current Claude Code session**. In practice it has no notion of session ownership at all: `findActiveRun` walks up from `cwd`, scans every `.claude/feature-pipeline/*/state.json`, and returns whichever run has `active: true` and the most recent `updatedAt` — regardless of which session created it or is currently driving it.

When two Claude Code sessions are open in the same project (a common case: one terminal driving Infero work, a second one helping debug something else), both sessions share the same `.claude/feature-pipeline/` directory. Session A starts a run. Session B's Stop hook fires after any normal turn and discovers A's run. The hook outputs `{ decision: "block", reason: "...you MUST invoke Skill(dp:<A's currentStep>)..." }`, which blocks B's turn-end and nudges B's model to invoke a skill that's actually for A's run.

The fix: tag each run with the session that created it, and have `findActiveRun` + the Stop hook only consider runs whose `sessionId` matches the currently running session. Claude Code's hook input already includes `session_id` on stdin; we just need to propagate it from init time (orchestrator) into `state.json`, and read it at hook time.

## Related files

### Entry points
- [hooks/hooks.json](hooks/hooks.json) — registers the plugin-wide Stop hook; will gain a SessionStart hook to capture session_id for the orchestrator.
- [commands/dev-pipeline.md](commands/dev-pipeline.md) — orchestrator; needs to read the current session_id and pass it to `advance.ts init` when creating a new run.

### Core code to modify
- [scripts/hooks/enforce-pipeline-progress.ts](scripts/hooks/enforce-pipeline-progress.ts) — Stop hook; currently reads `cwd` and calls `findActiveRun(cwd)` with no session filter. Needs to parse `session_id` from stdin and pass it through.
- [scripts/lib/findRun.ts](scripts/lib/findRun.ts) — `findActiveRun(startDir)` returns ANY active run under the project. Needs an optional `currentSessionId` argument and must filter out runs whose `state.sessionId` differs.
- [scripts/lib/state.ts](scripts/lib/state.ts) — `PipelineState` interface needs an optional `sessionId?: string` field; `buildInitialState` needs to accept and write it.
- [scripts/cli/advance.ts](scripts/cli/advance.ts) — `init` subcommand needs to accept the session id (positional arg or flag) and pass it to `buildInitialState`.

### Sibling files (no changes expected, but worth knowing)
- All `skills/*/SKILL.md` — invoke `bun .../scripts/cli/advance.ts ...`. They do NOT need to know the session id; only the orchestrator does (at init time).
- [scripts/cli/status.ts](scripts/cli/status.ts) — calls `findActiveRun`; will inherit the session filter automatically once the function changes.

### Live evidence of the bug (in the user's environment, not committed)
- `/Users/kostiantynzvonilov/projects/sd/infero/.claude/feature-pipeline/email-newsletter-video-editor/state.json` — `active: true`, `currentStep: codereview`, `updatedAt: 2026-05-11T20:00:48Z`. No `sessionId` field. Any new session's Stop hook in Infero will pick it up.
- `/Users/kostiantynzvonilov/projects/sd/infero/.claude/feature-pipeline/{mobile-favourites-filter-button, nsfw-age-gate-on-e1, showcase-per-preset-text-image-editor}` — all `active: false` (correctly inert).

### Reference pattern (don't modify — read for design)
- [~/.claude/plugins/cache/piercelamb-plugins/deep-plan/0.3.2/scripts/hooks/capture-session-id.py](~/.claude/plugins/cache/piercelamb-plugins/deep-plan/0.3.2/scripts/hooks/capture-session-id.py) — gold reference for capturing `session_id` in a SessionStart hook and exposing it via `hookSpecificOutput.additionalContext` (which Claude Code prepends to the session's prompt as a system reminder). The session_id is read from the stdin JSON `session_id` field.
- [~/.claude/plugins/cache/piercelamb-plugins/deep-plan/0.3.2/hooks/hooks.json](~/.claude/plugins/cache/piercelamb-plugins/deep-plan/0.3.2/hooks/hooks.json) — registers a SessionStart hook the same way our `hooks/hooks.json` registers a Stop hook.

## Existing code worth reusing

- **`additionalContext` pattern via SessionStart hook** — exactly the mechanism used by deep-plan's `capture-session-id.py`. Our SessionStart hook should output `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "DP_SESSION_ID=<id>" } }`. Claude Code prepends that to the conversation as a system reminder, so the orchestrator (running as Claude) can read `DP_SESSION_ID=<id>` from its own context and pass it to `advance.ts init`.

- **`scripts/lib/state.ts` `getByPath` / `setByPath`** — already used by `advance.ts set` for arbitrary nested updates; could be reused if we ever need to mutate `state.sessionId` after the fact (e.g. a tag-on-touch migration for old runs).

- **`findActiveRun`'s existing multi-match resolution** (sort by `updatedAt` descending, return first) — keep as is; just apply the session filter before that sort.

## Risks & unknowns

- **Backward compatibility for existing state.json files without `sessionId`.** Three plausible policies:
  1. Treat as "session-agnostic" — visible to all sessions (preserves current bug for legacy runs).
  2. Treat as "ownerless" — ignored by all sessions (would orphan legitimate in-flight runs that pre-date the upgrade).
  3. Tag-on-touch — if state has no `sessionId` and the current session interacts with it, stamp it. Then subsequent sessions filter it out.
  
  Recommended path: policy 3 with a clear log message ("adopting orphan run X for this session"). To be confirmed in plan-proposal.

- **Session id source for the orchestrator.** Claude Code emits `session_id` on hook stdin, but the orchestrator is a slash command body that Claude executes — it doesn't have direct stdin access. The SessionStart-hook + `additionalContext` pattern (deep-plan style) is the standard way to expose it to Claude. Risk: if a user disables the SessionStart hook, the orchestrator falls back to running without a session id. Recommended: orchestrator detects missing `DP_SESSION_ID`, falls back to current behavior (no filter) and warns once.

- **`/clear` mid-pipeline.** Claude Code assigns a NEW session_id after `/clear`. A run created before `/clear` would then look like "another session's" run to the post-clear conversation, blocking resumption. Mitigation: when the orchestrator's "implicit continuation" or "explicit resume" path matches a run, allow override — explicit user-driven resume bypasses the session filter.

- **Concurrent advance writes.** Two sessions writing to different runs is fine. Two sessions writing to the SAME `state.json` (shouldn't happen after the filter, but theoretically) would race. Out of scope unless we observe it.

- **Cross-machine resume.** A run created on machine A with one session_id is opened on machine B. Machine B's session has a different id. Same as the `/clear` case — explicit resume must bypass the filter. New runs always start fresh.

- **Old runs in the user's Infero project right now.** `email-newsletter-video-editor` is active=true with no sessionId. The user will need to either abort it manually or let policy 3 (tag-on-touch) adopt it. Calling this out so plan-wrapup doesn't forget the migration story.

- **Multiple plugin installations / cache vs source.** When the user develops the plugin and also uses it on Infero, `${CLAUDE_PLUGIN_ROOT}` could point at either location depending on how they launched the session. The SessionStart hook is registered in `hooks/hooks.json` at plugin root, so this should work in both — but we need to verify after install that the SessionStart hook actually fires.

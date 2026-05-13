# Plan: session-scoped-stop-hook

## Context

The dp plugin's Stop hook is meant to enforce pipeline progression for the **current** Claude Code session. In practice it has no session awareness: [scripts/lib/findRun.ts](../../../scripts/lib/findRun.ts) discovers any `active: true` run under `cwd`'s `.claude/feature-pipeline/`, and [scripts/hooks/enforce-pipeline-progress.ts](../../../scripts/hooks/enforce-pipeline-progress.ts) calls it with `cwd` only. When two Claude Code sessions share a project, one session's Stop hook routinely blocks the other session's text-stops and even nudges it to invoke an unrelated skill from the other session's pipeline. We've reproduced this in the user's Infero project where `email-newsletter-video-editor` (from another session) is still `active: true` and would block any new session in that project.

Success means: a session only ever sees pipeline runs it created (or runs it explicitly resumed). Legacy runs without session tags get adopted on first interaction (tag-on-touch). Explicit-resume paths still work across sessions and across `/clear`. Backward-compat: state.json without `sessionId` keeps working until something writes to it.

## Approach

Capture Claude Code's `session_id` on `SessionStart` and expose it to the orchestrator (which is just Claude executing a slash command body) via the standard `hookSpecificOutput.additionalContext` channel — the same pattern deep-plan uses. Persist that id in `state.json` at run creation. Filter `findActiveRun` by session id. The Stop hook reads `session_id` from its own stdin payload (primary), with `process.env.DP_SESSION_ID` as a defensive fallback in case the stdin payload is malformed.

To handle pre-upgrade runs gracefully, all `advance.ts` mutating subcommands (`set`, `advance`, `abort`) tag-on-touch: if `state.sessionId` is missing AND the caller supplied a current session id, stamp it. After the first touch, the run is session-scoped going forward. Auto-discovery (Stop hook, `status.ts`) enforces the session filter. Explicit-resume orchestrator paths go one step further: they **transfer ownership** by overwriting `state.sessionId` with the current session id before the first skill runs, so `/clear` and cross-machine resume continue to work AND the Stop hook resumes enforcing progression on the resumed run.

No new external dependencies. All changes are inside this plugin.

## File-by-file changes

### `scripts/hooks/capture-session.ts` (new)

- **Change**: create
- **What**: SessionStart hook. Reads the hook event JSON from stdin (`Bun.stdin.text()` → `JSON.parse`), pulls `session_id`. Does two things in parallel, mirroring deep-plan's belt-and-suspenders approach:
  1. **Primary**: emit `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "DP_SESSION_ID=<id>" } }` on stdout, so Claude sees it in its context.
  2. **Secondary**: if `CLAUDE_ENV_FILE` env var is set and writable, append `export DP_SESSION_ID=<id>` to it (idempotent — skip if already present). This is a fallback for cases where Claude doesn't relay the flag (advance.ts reads the env var if `--session` is absent).
- Silently exits 0 on any parse error so a malformed payload never breaks session start.
- **Why**: gives both the orchestrator/skills (via `additionalContext`) and the scripts (via env var) a way to learn the current session id, exactly the way deep-plan does it.

### `hooks/hooks.json` (modify)

- **Change**: modify
- **What**: add a `"SessionStart"` entry alongside the existing `"Stop"` entry, registering `bun ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/capture-session.ts`.
- **Why**: registers the new hook so Claude Code fires it.

### `scripts/lib/state.ts` (modify)

- **Change**: modify
- **What**: add optional `sessionId?: string` to the `PipelineState` interface. Update `buildInitialState(slug, args, sessionId?)` signature — when supplied, include it in the returned state; when omitted, leave the field absent (legacy shape).
- **Why**: the canonical place runs gain their session tag.

### `scripts/cli/advance.ts` (modify)

- **Change**: modify
- **What**: four changes.
  1. `init` accepts an optional 4th positional arg `sessionId` and passes it to `buildInitialState`. Usage updated accordingly.
  2. `set`, `advance`, `abort` accept an optional `--session <id>` flag (parsed by simple `process.argv` scan, no library). When present AND `state.sessionId` is missing, stamp `state.sessionId = <id>` before any other mutation (tag-on-touch). Also: when present AND `state.sessionId` exists AND the caller is doing an explicit `set state.sessionId=...` operation, allow the overwrite (used by the orchestrator's explicit-resume ownership-transfer path).
  3. **Env-var fallback** (deep-plan pattern): if `--session` flag is absent, fall back to `process.env.DP_SESSION_ID`. The "effective session id" used for tag-on-touch is `--session flag ?? process.env.DP_SESSION_ID ?? null`. If both are absent, no tag-on-touch occurs.
  4. The usage string is updated to document the new arg, flag, and env-var fallback.
- **Why**: makes the CLI the single chokepoint for session-tag writes. Gives legacy runs a clean upgrade path without a migration script. Belt-and-suspenders matches deep-plan's robustness model.

### `scripts/lib/findRun.ts` (modify)

- **Change**: modify
- **What**: `findActiveRun(startDir, currentSessionId?)` — when `currentSessionId` is a non-empty string, drop any run whose `state.sessionId` is set and not equal to `currentSessionId`. Runs with no `sessionId` are still considered (legacy + tag-on-touch will fix them). When `currentSessionId` is undefined, behave exactly as today (no filter) — preserves backward compat in callers that haven't been updated.
- **Why**: the actual session boundary.

### `scripts/hooks/enforce-pipeline-progress.ts` (modify)

- **Change**: modify
- **What**: parse the stdin JSON payload (instead of just draining it). **Order is critical**: (1) read stdin via `await Bun.stdin.text()`, (2) try `JSON.parse` inside try/catch, (3) extract `session_id` from the parsed payload (or fall back to `process.env.DP_SESSION_ID` for defensive safety), (4) THEN call `findActiveRun(cwd, sessionId)`. Do NOT call `findActiveRun` before reading session_id — otherwise the filter is silently inert and the regression slips by tests that only check positive cases. The block-message rendering for "you must invoke `dp:<step>`" is unchanged — only the discovery is scoped.
- **Why**: the hook is the most direct fix for the reported behaviour, and the explicit step ordering protects against a silent regression.

### `scripts/cli/status.ts` (modify)

- **Change**: modify
- **What**: the in-session "what's my pipeline state?" command — accepts an optional `--session <id>` flag and passes it to `findActiveRun`. If not supplied, no filter is applied (mirrors `findActiveRun`'s default). The orchestrator and ad-hoc `bun status.ts` invocations can pass the current id when they have it.
- **Why**: same filter semantics across all auto-discovery callers.

### `commands/dev-pipeline.md` (modify)

- **Change**: modify
- **What**: three additions.
  1. New top section "**Session id capture and propagation**" — this becomes the canonical convention skills also reference. Tells Claude (acting as the orchestrator or any skill body) to:
     - Scan the conversation's system-reminder messages for a line matching `^DP_SESSION_ID=(\S+)$`.
     - If multiple matches exist (e.g. across `/clear` boundaries), take the **last** one — it reflects the current session.
     - If found, use it as `<DP_SESSION_ID>` and append `--session "<DP_SESSION_ID>"` to every `bun .../scripts/cli/advance.ts <set|advance|abort>` call.
     - If not found, omit `--session` and rely on advance.ts's env-var fallback (`process.env.DP_SESSION_ID`). Print one warning if both context-id and env-var would be missing.
  2. Step 2 (Create or load the run): pass the captured session id as the 4th positional to `bun .../advance.ts init`. If not found in context, omit (env-var fallback applies).
  3. Step 1 classifier — "Explicit continuation by path" and "Implicit continuation by phrasing" branches bypass the auto-discovery session filter (they're user-driven). After locating the target run via these paths, the orchestrator immediately runs `bun .../advance.ts set <run-dir> sessionId '"<current-id>"' --session "<current-id>"` to **transfer ownership** to the current session before invoking the next skill. The Stop hook then enforces progression normally for the rest of the run.
- **Why**: makes the orchestrator the canonical reference for session-id propagation; every skill points back to this section.

### All 9 `skills/<name>/SKILL.md` files (modify)

- **Change**: modify (one small addition each)
- **What**: at the top of each skill's "Procedure" section, add a one-line preamble:

  > **Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator's "Session id capture and propagation" section for the matching rule), pass `--session "<id>"` on every `bun .../scripts/cli/advance.ts set|advance|abort` call you make in this skill. If the line is not in context, omit it (advance.ts falls back to `process.env.DP_SESSION_ID`).

  Then update the example `bun .../advance.ts ...` command lines in the body to show the `--session` flag with a placeholder, e.g.:

  ```
  bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.<step>.status running --session "<DP_SESSION_ID>"
  ```

  Files: `investigation`, `plan-proposal`, `plan`, `plan-improve`, `plan-improve-apply`, `plan-wrapup`, `implementation`, `codereview`, `improve`.
- **Why**: each skill becomes session-aware in its writes, so tag-on-touch fires consistently and the user's "current session" never silently drifts. Matches deep-plan's pattern of repeating the flag in every relevant skill body.

### `README.md` (modify)

- **Change**: modify
- **What**: two additions.
  1. New subsection `### Session scoping` placed **between** the existing "Hook enforcement (implementation step only)" and "Working on the plugin itself" sections. Explains: each session sees only its own runs; the `DP_SESSION_ID` mechanism (SessionStart hook + `additionalContext` + env-var fallback); tag-on-touch for legacy runs; explicit-resume transfers ownership. Also includes a one-line note that we deliberately use `DP_SESSION_ID` rather than reusing `DEEP_SESSION_ID` to avoid coupling to the deep-plan plugin.
  2. New subsection `### Upgrading from v0.4.x to v0.5.0` placed under the existing "Publishing updates" section. Calls out the operational impact for end users:
     - SessionStart hooks fire only on session start. After running `claude plugin marketplace update claude-dev-pipeline-plugin` + `/reload-plugins`, the hook code is loaded but `DP_SESSION_ID` is NOT in the current conversation's context. The user MUST start a fresh Claude Code session in the project before launching any new `/dp:dev-pipeline` run, otherwise the run will be created without a sessionId tag (the env-var fallback also won't help mid-conversation because CLAUDE_ENV_FILE was set before the hook was registered).
     - Existing active runs from before the upgrade have no sessionId. They will be adopted on first interaction (tag-on-touch). If two old sessions both still reference such a run, only the first to interact with it claims it.
- **Why**: visible behaviour change for end users; the upgrade path has a real footgun (mid-conversation upgrade silently bypasses the fix) that needs to be flagged.

### `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (modify)

- **Change**: modify
- **What**: bump `version` from `0.4.6` to `0.5.0` in both files (matching pairs in marketplace.json — both the marketplace-level and plugin-entry `version`).
- **Why**: behaviour change for end users (introduces a new state.json field, new hook, new filter semantics). MINOR bump because it's additive + backward-compat for legacy state.

## Reuse & extraction (REQUIRED — do not skip)

### Existing code being reused

- `buildInitialState` at `scripts/lib/state.ts` → updated in place to accept an optional `sessionId`; all `advance.ts init` paths go through it. No duplication.
- `findActiveRun` at `scripts/lib/findRun.ts` → updated in place to accept an optional current session id. The existing multi-match resolution (sort by `updatedAt` desc, return first) is kept verbatim; we just apply the filter before that sort.
- `setByPath` at `scripts/lib/state.ts` → reused for the tag-on-touch write in `advance.ts set / advance / abort`. No new path-traversal helper.
- The hook-event JSON parsing idiom from the existing Stop hook (`await Bun.stdin.text()` → `JSON.parse`) → mirrored in the new SessionStart hook; both files use the same defensive try/catch + silent-exit pattern.
- deep-plan's `capture-session-id.py` (at `~/.claude/plugins/cache/piercelamb-plugins/deep-plan/0.3.2/scripts/hooks/capture-session-id.py`) → read for reference only (proves the `additionalContext` channel works), not imported or vendored.

### One-time-used code being extracted into a common component

- The "parse `--session <id>` flag from `process.argv`" logic appears in three places in `advance.ts` (`set`, `advance`, `abort`). Extract it once as `parseSessionFlag(argv: string[]): { sessionId: string | undefined; rest: string[] }` near the top of `scripts/cli/advance.ts` (or in `scripts/lib/state.ts` if it grows). Call sites: all three subcommands inside `advance.ts`. No third caller exists — moving to a shared lib file would be over-extraction; keep it as a local helper inside `advance.ts` for now.
- The "extract `session_id` from a hook payload" logic appears in two places: the new SessionStart hook and the updated Stop hook. Extract as `readHookSessionId(): Promise<string | null>` in a new `scripts/lib/hookSession.ts`. Both hooks import it. Justifies the extraction because there are immediately two callers and any future hook would be a third.

## Migration notes (one-time, for users upgrading from v0.4.x)

End users will have zero or more pre-existing pipeline runs at `<project>/.claude/feature-pipeline/<name>/state.json` without a `sessionId` field. Three categories to handle:

- **Active and intentional** — the user is still mid-pipeline on that run. Recommended: open the run via `/dp:dev-pipeline continue <name>` from the session that should own it; the orchestrator's ownership-transfer logic will stamp the current session's id. After that, the run is properly scoped.

- **Active but stale** (the most common case after concurrent-session bugs — e.g. the `email-newsletter-video-editor` run currently visible in the user's Infero project, marked `active: true` with `currentStep: codereview`). Recommended action: manually abort via `bun ~/projects/claude-dev-pipeline-plugin/scripts/cli/advance.ts abort <run-dir>` from any session. The run becomes inert and stops blocking future Stop hooks. If the original work is genuinely needed, re-resume it explicitly via `/dp:dev-pipeline continue <name>` AFTER the abort (which sets active=false but preserves artifacts).

- **Already done** (`active: false`) — no action needed. The hook ignores them.

Document the above in the README upgrade subsection. Provide the exact `abort` one-liner so users don't have to look it up.

## Verification

1. **Typecheck stays clean.** `cd ~/projects/claude-dev-pipeline-plugin/scripts && bun run typecheck` — no errors.
2. **Existing single-session run is unaffected.** From the plugin's own repo, run `/dp:dev-pipeline some test feature`, walk through investigation/proposal, and confirm the Stop hook still blocks text-stops when a step is pending. Confirm `state.json` now contains a `sessionId` field.
3. **Cross-session block is gone.** With the live Infero scenario:
   - Open Claude Code session A in `~/projects/sd/infero/` and start a dp run (its `state.json` gets `sessionId: <A-id>`).
   - Open a separate Claude Code session B in the same project.
   - In B, type any normal turn (no dp run). The Stop hook fires and exits 0 — no block. Confirm by checking session B's transcript / hook log.
4. **Tag-on-touch.** Manually create a `state.json` with `active: true` and no `sessionId` (or, if the user opts not to abort it per the Migration notes above, use the existing `email-newsletter-video-editor` orphan as the fixture). In a fresh session, call `bun .../advance.ts set <run> someKey true --session <session-id>`. Re-read `state.json`: `sessionId` should now equal the supplied id.
5. **Explicit resume transfers ownership.** From a NEW session, run `/dp:dev-pipeline <abs-path-to-other-session's-run>`. Confirm it resumes (no "doesn't belong to your session" rejection). Open `state.json` afterwards: `sessionId` is now the current session's id, not the original owner's. Continue the resumed pipeline through one more step — confirm the Stop hook enforces progression normally (i.e. blocks if you try to text-stop while a step is pending). Note: only explicit-path or `continue <name>` paths transfer ownership — auto-discovery still respects existing ownership.
6. **Missing `DP_SESSION_ID` graceful path.** Temporarily disable the SessionStart hook (comment out the entry in `hooks/hooks.json`), reload. Run `/dp:dev-pipeline foo`. Confirm: orchestrator prints a one-line "no session id available" warning, creates the run without `sessionId`, and the pipeline still works (filter is inert).
7. **Mid-conversation upgrade footgun.** In a long-running Claude Code session that pre-dates v0.5.0, run `claude plugin marketplace update claude-dev-pipeline-plugin` + `/reload-plugins`. Then run `/dp:dev-pipeline foo`. Confirm: `state.json` has no `sessionId` (SessionStart didn't fire mid-session, env var was set before the hook was registered, so context is empty). Then start a fresh Claude Code session in the same project and re-run; confirm `sessionId` is populated. This scenario is documented in the README upgrade notes.
8. **/clear resumability.** Start a run, `/clear`, then `/dp:dev-pipeline continue <name>`. Confirm it resumes despite the new session id. (After /clear, the SessionStart hook fires again with the new id.)
9. **Hook unit-style smoke test.** `echo '{"session_id":"sess-XYZ"}' | bun scripts/hooks/capture-session.ts` → stdout JSON contains `"additionalContext": "DP_SESSION_ID=sess-XYZ"`. `echo '{}' | bun scripts/hooks/capture-session.ts` → exits 0, no output (graceful).
10. **Concrete orphan migration.** In the user's Infero project, run `bun ~/projects/claude-dev-pipeline-plugin/scripts/cli/advance.ts abort /Users/kostiantynzvonilov/projects/sd/infero/.claude/feature-pipeline/email-newsletter-video-editor` (or whatever orphan is live at upgrade time). Confirm `state.active: false`. Then run any normal turn from a fresh session in Infero and confirm the Stop hook does NOT block (no active run is discoverable).

## Out of scope (intentional)

- Per-user / per-machine ACLs beyond session id. We trust whatever Claude Code reports as `session_id`.
- Multi-machine state sync (Dropbox-style live merging of `state.json` across devices). Out of charter.
- Persisting session id across `/clear`. Claude Code assigns a fresh id; explicit resume covers that.
- Garbage-collecting orphan runs (legacy `active: true` runs with no session id and no recent activity). The user can `bun .../advance.ts abort` manually; an auto-GC tool is a separate feature.
- Backporting the filter to runs created before the upgrade (they'll be adopted via tag-on-touch on first interaction; no migration script).
- A `--no-session-filter` escape hatch on the Stop hook. The explicit-resume orchestrator path already gives the user manual control; adding a global override would re-create the bug.

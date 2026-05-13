# Review: session-scoped-stop-hook

1. **[HIGH | confidence: HIGH]** Explicit-resume must transfer sessionId, not just bypass the filter.

   The plan says explicit-resume paths (`/dp:dev-pipeline <abs-path>` and `/dp:dev-pipeline continue <name>`) bypass the session filter so `/clear` and cross-machine resume work. But "bypass" alone leaves `state.sessionId` set to the OLD session id. Consequence: the new session drives the run, but its Stop hook calls `findActiveRun(cwd, newSessionId)` → filter excludes the run (sessionId mismatch) → hook returns null → no progression enforcement for the resumed run. The pipeline still progresses via skill-chain Skill invocations, but the safety net is gone for exactly the run the user actively asked to resume.

   Fix: on explicit-resume, the orchestrator must **transfer ownership** — set `state.sessionId = <current session id>` before invoking the matching skill. Tag-on-touch in `advance.ts set` already has the mechanism; the orchestrator just needs to call `bun .../advance.ts set <run> sessionId '"<current>"' --session <current>` (or a dedicated `claim` subcommand) on the resume path. Document this in the plan and add a verification step that confirms `state.sessionId` updates on explicit resume.

2. **[MEDIUM | confidence: HIGH]** Tag-on-touch only fires for the orchestrator; skill bodies don't pass `--session`.

   `advance.ts set / advance / abort` are called from every skill body (investigation step 1, plan step 4, etc.), but the plan only updates the **orchestrator** to pass session id (via `init`). Skill bodies invoke `bun .../scripts/cli/advance.ts set <RUN_DIR> ...` with no `--session` flag. Consequence: tag-on-touch never fires from inside a skill — only the orchestrator's first `init` writes `sessionId`. Legacy runs adopted via explicit-resume wouldn't get a sessionId until the user manually edits state.json or restarts the orchestrator.

   Fix: every skill body needs to pass `--session <DP_SESSION_ID>` on its `advance.ts` calls. That means every SKILL.md needs to teach the model how to find `DP_SESSION_ID` in its context (same instruction as the orchestrator) and append `--session <id>` to its bun invocations. Add this as an explicit file-by-file change for all 9 skill markdown files, or extract the "pass --session" boilerplate into a shared "Skill helper conventions" section in the orchestrator that all skills reference.

3. **[MEDIUM | confidence: HIGH]** First-upgrade UX gap: the user's current session has no DP_SESSION_ID until they restart.

   `SessionStart` hooks fire only on session start. A user upgrading mid-session (run `/plugin marketplace update` + `/reload-plugins` on the v0.4.6 → v0.5.0 jump) will have the new hook code loaded but the SessionStart hook never fires retroactively. Their existing conversation has no `DP_SESSION_ID=<id>` system reminder. The orchestrator's "missing → warn and proceed without sessionId" path triggers for every new run started in this stale session, defeating the fix for them.

   Fix: either (a) the orchestrator falls back to reading `transcript_path` from disk or another mechanism, or more practically (b) document that users must start a fresh Claude Code session after upgrading to v0.5.0. Add a "Upgrading from v0.4.x" note to the README under Publishing updates. Add a Verification step that explicitly checks the "first session after upgrade" scenario.

4. **[MEDIUM | confidence: MEDIUM]** Concrete migration story for in-flight orphan runs is missing.

   `context.md` flagged `email-newsletter-video-editor` (active=true, no sessionId, from another session) as live evidence. The plan's tag-on-touch policy adopts such runs on first interaction, but doesn't say what the user should do about THIS specific orphan today. Three plausible flows:
   - Manually `abort` it via `bun .../advance.ts abort` (user's call).
   - Let the first session that lands in Infero adopt it (could be the wrong session — the original owner may still exist and want it back).
   - Provide a `bun .../advance.ts list-orphans` helper.

   Fix: add a "Migration notes" subsection to the plan listing the concrete action the user should take for any pre-existing active-without-sessionId runs (recommended: abort and re-run if needed). Add a verification step that confirms the user's specific orphan is handled.

5. **[MEDIUM | confidence: HIGH]** Stop hook stdin parsing order needs to be specified.

   Current Stop hook reads `cwd` and calls `findActiveRun(cwd)` (line 23-24) before draining stdin (line 21 is `await Bun.stdin.text().catch(() => "")`). Actually re-reading: stdin IS read first then discarded. The plan says "parse the stdin JSON payload (instead of just draining it)". Fine — but the new flow must read stdin BEFORE calling findActiveRun, because findActiveRun's signature now needs the session id. The plan should explicitly state the order so the implementer doesn't ship a regression where session_id is read after findActiveRun and silently ignored.

   Fix: in the file-by-file entry for `enforce-pipeline-progress.ts`, add an explicit step ordering: (1) read+parse stdin JSON, (2) extract `session_id`, (3) call `findActiveRun(cwd, sessionId)`. One sentence is enough.

6. **[LOW | confidence: HIGH]** Orchestrator "read DP_SESSION_ID from system-reminder context" instruction is too vague.

   The plan says "scan its system-reminder context for a line matching `DP_SESSION_ID=<id>`. If found, treat that as the current session id." That leaves the matching pattern implicit. Different Claude implementations may extract differently (e.g. match `^DP_SESSION_ID=([^\s]+)`, or look anywhere in context, or take first vs last match if multiple sessions stacked). The orchestrator body should specify the exact regex or matching rule it expects, e.g. "the LAST `DP_SESSION_ID=<id>` line wins" (because `/clear` reissues it).

   Fix: tighten the instruction in `commands/dev-pipeline.md` to: "Scan the conversation system-reminder messages for a line matching `^DP_SESSION_ID=(\S+)$`. If multiple matches (e.g. across `/clear` boundaries), take the LAST one. If none, proceed without and print one warning."

7. **[LOW | confidence: MEDIUM]** Why `DP_SESSION_ID` and not reuse `DEEP_SESSION_ID`?

   Users running both deep-plan and dp will have BOTH `DEEP_SESSION_ID=<id>` and `DP_SESSION_ID=<id>` in their context, with identical values (both come from Claude Code's `session_id`). Not broken, but redundant and slightly noisy. Worth a one-line README note explaining the deliberate decoupling (we don't want to depend on deep-plan being installed).

   Fix: add a sentence to the README's new "Session scoping" subsection: "We deliberately use our own `DP_SESSION_ID` instead of `DEEP_SESSION_ID` to avoid coupling to the deep-plan plugin."

8. **[LOW | confidence: HIGH]** README subsection placement should be explicit.

   Plan says "short subsection under 'How the pipeline works' explaining session scoping". The README structure confirms that section exists ([README.md:63](README.md)). But the most natural fit is actually under "Hook enforcement (implementation step only)" ([README.md:78](README.md)) since session scoping is hook-related. Decide which and update the file-by-file entry to point at the exact section.

   Fix: pick one location, name it in the file-by-file entry. Recommended: new section "### Session scoping" between "Hook enforcement" and "Working on the plugin itself".

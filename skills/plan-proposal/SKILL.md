---
name: plan-proposal
description: Use when an active dev-pipeline run is at the plan-proposal step. Prints a short proposal (user request + optional root cause for bugs + plan proposal + technical approach) for fast user feedback before any plan file is written. Loops on feedback until approved.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(bun *)
  - AskUserQuestion
---

# dp:plan-proposal

Short proposal, fast user feedback. **No `plan.md` is written at this stage.** This is the cheap-iteration gate — you want the user to redirect you here, not after a 500-line plan exists.

## Inputs

- `RUN_DIR` — run directory.
- `<RUN_DIR>/context.md` — produced by `dp:investigation`. Read this in full.
- `<RUN_DIR>/state.json` — for `args` and `autonomous` flag.

## Procedure

**Session id**: if a `DP_SESSION_ID=<id>` line is present in your conversation context (see the orchestrator command's "Session id capture and propagation" section for the matching rule), substitute that value for every `<DP_SESSION_ID>` placeholder in the bun commands below. If the line is not in context, drop the `--session "<DP_SESSION_ID>"` argument entirely; `advance.ts` falls back to `process.env.DP_SESSION_ID`.

### 1. Mark step as running

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-proposal.status running --session "<DP_SESSION_ID>"
```

### No shortcuts — propose the proper fix, not a band-aid

Propose the thorough approach, not a quick patch. The user rejects a lazy proposal and asks for the proper fix anyway — proposing the shortcut just wastes a whole proposal cycle.

Exception: if the user explicitly asked for a minimal diff or "just patch this one place", follow that — and say so in section 1 (User request) so the narrowed scope is visible.

### Resolve every decision BEFORE printing the proposal — no TBDs

The proposal is what you **commit to**, not a worksheet. Before printing section 2, scan your draft for any of:

- `TBD`, `tbd`, `<choose>`, `<TODO>`, `?`, "open question", "to be decided"
- "proposing X (Y is the alternative if you prefer)"
- "label TBD — suggesting X"
- "either A or B — let me know"
- Any phrasing that defers a decision into the proposal text

If you find any, you have two paths and only two:

1. **Decide.** Pick the option you think is right. Commit to it in the proposal text. The user can still redirect via the "Other" rejection path on the approval question — they don't need a parenthetical menu.
2. **Ask via `AskUserQuestion` FIRST**, get the answer, THEN print the proposal with the resolved choice baked in. Use this only when the choice genuinely changes the scope (e.g. "should this be a new endpoint or extend the existing one?") and you can't reasonably commit without more input. Mundane choices (naming, copy wording, label text) → just decide.

Never print a proposal that contains a deferred decision. The user reads the proposal expecting it to represent your committed plan. A "TBD" inside section 2 means you handed off the decision instead of making it.

**Anti-example — TBD embedded in the proposal:**

> - Add Nano Banana Pro (`google/gemini-3-pro-image-preview`) as a third entry in the textImageEdit model registry; in the UI it shows up as a new option in the existing model dropdown (label TBD — proposing "Nano Banana Pro" since that's its product name; "Gemini 3 Pro Image" is the fallback if you prefer a generic name).

Two failures here: (a) the model embedded a menu into the bullet instead of picking, and (b) the parenthetical is longer than the actual change. Corrected:

> - Add `google/gemini-3-pro-image-preview` as a third entry in the textImageEdit model registry; UI label "Nano Banana Pro" (product name). New option in the existing model dropdown.

If the user prefers "Gemini 3 Pro Image" they say so on rejection — but the proposal commits.

### 2. Print the proposal in chat — three required sections + one conditional, distinct shapes

The proposal must be **scannable in under 30 seconds**. The user reviews it to redirect approach BEFORE you spend effort on a detailed plan.

The sections are deliberately ordered so the user can stop reading at section 1 if you misunderstood the request, instead of slogging through plan/tech-approach prose first. **Section 1.5 (Root cause) is MANDATORY for bug fixes and MUST BE OMITTED for non-bugs.**

```
## Proposal — <feature name>

### 1. User request
<ONE short paragraph (2–4 sentences) restating, in your own words, what the user is asking you to do. This is the model's understanding of the task. NOT the plan. NOT bug analysis. NOT "what's wrong". Just: "you want me to <X> so that <Y>."

If the user explicitly told you the goal/why, paraphrase faithfully. If they gave only symptoms or a vague ask, state the inferred goal here so they can correct you immediately.>

### 1.5. Root cause   (MANDATORY for bug fixes — OMIT this section entirely for features, refactors, additions)
<2–3 sentences: where the bug occurs, why it occurs, and (if relevant) why it wasn't caught earlier. Pure diagnosis — no fix proposal here.

Lets the user verify your diagnosis is right BEFORE reviewing the fix.>

### 2. Plan proposal
<Bullet list. One bullet per distinct point. Each bullet 1–3 lines, no more.

Cover everything the user needs to evaluate the plan: what you'll add/change/remove, the user-visible result, what's deliberately out of scope.

For bug fixes: the diagnosis already lives in 1.5; bullets here are purely the fix.>

- <first key point>
- <next key point>
- ...
- Out of scope: <one final bullet listing what's intentionally not in this plan>

### 3. Technical approach
<The critical technical decisions — the "how", and why this way over the alternatives. This is the ONE section where code belongs: name concrete symbols/types/files, and include a short fenced code chunk when it's the clearest way to show a signature, data shape, or the crux of the approach.

3–6 decisions. Skip anything mechanically obvious from section 2. If there are genuinely none worth calling out, write "None — the approach in section 2 is mechanically obvious.">

- <decision: which approach you picked and what it beats — reference code or drop in a short chunk where it clarifies the choice>
- ...
```

**Section 1 (User request) rules:**

- ONE paragraph, 2–4 sentences. Any longer means you've started planning — move it to section 2.
- Restate the request faithfully, in plain language. Add the inferred goal/why if the user gave only symptoms.
- This section exists so the user can correct your understanding before reading further. If they say "no, you misunderstood" — you saved them from reviewing a plan based on the wrong premise.

**Section 1.5 (Root cause) rules — MANDATORY for bug fixes:**

- If the task is a bug fix, this section is **required**. Skipping it for a bug = wrong output.
- If the task is a feature, refactor, addition, doc change, anything non-bug — **omit the section entirely.** Do not print an empty header.
- 2–3 sentences, no more. Where it happens, why it happens, and (if relevant) why it wasn't caught.
- Pure diagnosis. Do NOT include the fix here — that's section 2.

**Section 2 (Plan proposal) rules:**

- **Bullet list.** One distinct point per bullet. No prose paragraphs. No headers, no nested sub-bullets unless absolutely required.
- **One idea per bullet.** Do not bundle two ideas into one bullet just because they relate. When in doubt, split.
- **Write at INTENT altitude, not code altitude.** Each bullet describes *what changes about the system's behavior*, not *what code edits land in the diff*. Code-altitude bullets — "rename X to Y", "add param to function Z", "drop the cross-site clause", "extend method M to handle case N", "change config field A to B", "replace import in file C" — are forbidden in section 2. The right altitude reads like: "We currently do X wrong, the change makes it Y, so the user/system sees Z" — or — "Add capability X via <high-level mechanism> so <user-visible result>." Never name a function, variable, identifier, file path, or symbol unless it's central to the *concept* of what's changing (e.g. swapping out an entire model is fine; renaming the function that consumes it is not).
- **Order bullets by importance, biggest first.** The first 2–4 bullets capture the **load-bearing changes** — the new behavior, new model, scope shift, the thing that justifies the work existing. Mechanical follow-ons (file renames, symbol renames, README touch-ups, cron-entry updates, dispatch-table edits) **don't belong in section 2 at all**. They go in `plan.md`. Cut them.
- **No fixed count.** Include every key point the user needs to evaluate the plan. Never drop a key detail to hit a length target. But: the *count* doesn't include code-altitude changes — those don't belong in the proposal.
- **No bloat.** Each bullet carries new information. No padding, no restating section 1, no "as mentioned above". Delete any bullet that doesn't add a key point.
- Each bullet is 1–3 lines. If it wraps past three lines, you're packing implementation detail in — extract to `plan.md`.
- **Last bullet is always "Out of scope: …"** listing what's intentionally not part of this plan.
- For bug fixes, the diagnosis is in 1.5 — bullets here are purely the fix at intent altitude ("change selection criterion to include site id" not "add `siteId` to the `where` clause of `findInvites`").

**Anti-example — code altitude, reads as a diff in English:**

> ### 2. Plan proposal
> - Move the Pending bucket from `GeneralSafetyInstructionRecordInvite` (PENDING status) to `EmployeeInvite` (status PENDING, employee connected, future `expireAt`, `acceptedAt` set) so the prod resolver returns employee and the badge switch lands on "Pending".
> - Keep the Orientation bucket as `GeneralSafetyInstructionRecordInvite` PENDING, but target site = `currentSite` (drop the cross-site indirection — option 1 needs same-site, the badge falls to "Orientation" because the orient fragment never fetches site regardless).
> - Retarget `planBucketsForSite`'s Pending count to `EmployeeInvite` (status PENDING at site) and Orientation count to same-site orient invites; drop the now-dead cross-site clauses (`site: { not: siteId }`, target-site instructor lookup, single-site guard).
> - Extend `createEmployeeInvites` to handle `EmployeeInviteStatus.PENDING` (status→bucket map now covers Pending/Invited/InvitationExpired); per-bucket pool partitioning is unchanged.
> - Revert the three `client/` debug-fetch beacons left over from the prior `/code-debug` session so the changeset is demo-data-only.

Failures: identifier names everywhere (`GeneralSafetyInstructionRecordInvite`, `planBucketsForSite`, `acceptedAt`, `where` clauses), parentheticals that describe code edits ("drop the cross-site indirection", "extend X to handle Y"), and the bullets read like the diff translated to English. A senior engineer skimming this can't tell *what's different from before* without reading the file paths.

Corrected at intent altitude — same scope, no code:

> ### 2. Plan proposal
> - Switch where the "Pending" bucket pulls from: workers in that bucket now have an in-flight employment invite at the current site instead of an in-flight orientation invite. This is what the prod resolver expects, so the worker's badge correctly resolves to "Pending" instead of falling back to "Orientation".
> - Drop the cross-site mechanism from the "Orientation" bucket — it was an artifact of the old setup. Both Pending and Orientation now seed at the current site, matching how the resolver actually selects invites.
> - Realign the per-site bucket planner to count Pending and Orientation by their new sources, removing the now-unused cross-site code paths.
> - Teach the invite creator about the new Pending bucket so seeding produces the same counts users requested.
> - Clean up leftover debug instrumentation from a previous debugging session — the changeset stays demo-data-only.
> - Out of scope: any frontend or server edits, cross-site Orientation, bucket-size retuning, translations, PDF flows.

Same five load-bearing changes. Zero identifier names. Each bullet reads as the *intent* of the change, not the diff. A reader who's never seen the codebase still understands what the system does differently after this lands.

**Anti-example — load-bearing changes buried, renames upfront:**

> ### 2. Plan proposal
> - Rename file `data-updaters/update-orientation-invites.ts` → `data-updaters/update-worker-invites.ts`; rename function `updateOrientationInvites` → `updateWorkerInvites`; rename cleanup helper `cleanupCompanyOrientationInvites` → `cleanupCompanyWorkerInvites`.
> - Rename config file `configs/orientation-invites.config.ts` → `configs/worker-invites.config.ts`; rename export `orientationInvitesConfig` → `workerInvitesConfig`.
> - Replace config shape entirely: drop `invitesPerSite` and `statusWeights`; add `workersPerStatus: { min: 2, max: 6 }`.
> - Rename EntityType `orientationInvite` → `workerInvite` in `types.ts`; update dispatch entry, CLI parser, cron entry, README table.
> - Roll per-bucket count via `faker.number.int(...)` four times per site; partition into 4 sub-cohorts.
> - Extend pool blacklist to also exclude workers with any live `EmployeeInvite`.
> - New per-site block creates `EmployeeInvite.INITIAL` rows with `expireAt = faker.date.soon({days:30})`.
> - Same block creates `EmployeeInvite.EXPIRED` rows with past `expireAt` — bypasses cron.
> - Add `EmployeeInvite` model to `prisma/schema.prisma`.
> - Add `selfOnboarding: true` site-settings flip.
> - Memoize `SubcontractorAssignment.id` lookups per site to avoid N+1.

That proposal is unreadable because the first thing the user sees is `update-orientation-invites.ts → update-worker-invites.ts`. They have no idea what the *feature* is until bullet 3 ("replace config shape entirely") and bullet 7 (new `EmployeeInvite` rows). Reordered:

> ### 2. Plan proposal
> - Replace `invitesPerSite` + `statusWeights` config shape with a single `workersPerStatus: { min: 2, max: 6 }` range, applied symmetrically across all 4 buckets.
> - Roll bucket size 4× per site, draw one inactive-worker pool sized to the sum, partition into 4 sub-cohorts (no cross-bucket overlap).
> - Seed `EmployeeInvite.INITIAL` rows per site (live, `expireAt = soon(30d)`) and `EmployeeInvite.EXPIRED` rows (terminal, past `expireAt`) — the EXPIRED branch bypasses the daily cron by writing the terminal state directly.
> - Extend the worker-pool blacklist to also exclude anyone with a live `EmployeeInvite` (INITIAL/PENDING).
> - Add `selfOnboarding: true` site-settings flip alongside the existing `selfSignOrientation: true` so the prod `sendEmployeeInvite` resolver precondition is satisfied.
> - Add `EmployeeInvite` model to `prisma/schema.prisma`; cleanup helper's `:force` path now wipes the old shape.
> - Mechanical: rename `orientation-invites` → `worker-invites` across file paths, exports, types, EntityType enum, dispatch entry, CLI parser, cron entry, README table.
> - Out of scope: PENDING/APPROVED/QR_INITIAL statuses, lifecycle transitions, non-US localization, renaming `show-orientation-invite-links.ts` (still tied to a separate flow).

Same scope; the user can stop reading at bullet 1 and already know what changed.

**Anti-example for a bug fix — section 2 written as prose, root cause missing:**

> ### 2. Plan proposal
> The demo safety-routine cron on sandbox is spamming retry warnings (`submitForm.fileUpload: unable to run execution in global scope in server context`) and the uploads ultimately fail. Root cause is a single line in `uploadWithSystemIdentity` that opens a fresh execution scope with type `'client'`. The server-side scope executor hard-throws on `'client'` and `'global'` — only `resolver/http/job/lambda` are permitted. The CLI seed never tripped this because the CLI doesn't initialize the server scope executor at all.

Prose instead of bullets, all diagnosis no plan, and 1.5 was missing.

**Correct shape for the same bug-fix proposal — 1.5 holds the diagnosis, 2 is a bullet list:**

> ### 1.5. Root cause
> `uploadWithSystemIdentity` opens a fresh execution scope of type `'client'`. The server-side scope executor (API server + Bull worker) hard-throws on `'client'`/`'global'` — only `resolver/http/job/lambda` are allowed. CLI silently accepted it via a permissive default-executor, which is why it wasn't caught.
>
> ### 2. Plan proposal
> - Switch the scope type used by `uploadWithSystemIdentity` from `'client'` to a server-permitted type (likely `'job'`) so the Bull-cron and API-server paths run without throwing.
> - CLI behaviour is unchanged because the CLI bypasses scope validation entirely.
> - Out of scope: refactoring `withRetry` so it doesn't blindly retry programmer errors, and any cleanup of the `'client'`/`'global'` taxonomy itself.

**Technical approach rules — this is the tech section; polarity is the OPPOSITE of sections 1/1.5/2:**

- Sections 1, 1.5, and 2 are code-free (intent altitude). Section 3 is where the engineering lives — a code-free section 3 is a **failed** section 3. If it has no concrete code reference, signature, or real decision, you haven't written it yet.
- Every entry is a real **decision**: which approach you picked and what it beats — "Use X over Y because Z". If there's no alternative worth weighing, it's not a decision — drop it.
- Code is required where it clarifies the decision:
  - Name concrete symbols, types, and files.
  - Include a short fenced code chunk (a signature, a type/data shape, the crux of the approach) when prose would be vaguer than the code.
  - Keep chunks illustrative — the crux, not the implementation. Past ~10 lines it belongs in `plan.md`.
- It is a decision, NOT an edit list. "Add param `P` to `F`" is an edit (→ `plan.md`). "Thread the site id through `F` instead of refetching it — signature becomes `f(siteId: string)`" is a decision (the code shows which option won).
- Only decisions that materially shape the implementation. **3–6 of them.** If there are genuinely none, say so explicitly — don't pad with platitudes.

Litmus test (inverted from section 2): if an entry would make equal sense pasted into *any* proposal — "follow existing patterns", "keep it maintainable", "use a scalable approach" — it's an empty platitude, not a decision. Cut it and write the actual choice, with the code that makes it concrete.

**Anti-example — vague platitudes, no decision, no code (this IS the "no technical decisions" failure):**

> ### 3. Technical approach
> - Follow the existing patterns.
> - Keep the result component clean and maintainable.
> - Use a scalable approach for the data flow.

Nothing here names a choice, beats an alternative, or touches code. It could be pasted into any proposal. That is exactly what an empty tech section looks like.

**Correct — real decisions, code where it clarifies the choice:**

> ### 3. Technical approach
> - Resolve preview items in the parent; the panel stays a dumb renderer taking `items: Item[]`. Alternative — pass `selectedItemId` + `mode` into the panel and let it look items up — rejected because it spreads the lookup across two components.
>   ```ts
>   // parent owns the lookup:
>   const items = getItemsFor(selectedId ?? fallback, { flagA, flagB })
>   return <ResultPanel items={items} />
>   ```
> - Use limit/offset pagination over cursor — the list is small and callers need jump-to-page.

Each entry names the pick, the alternative it beats, and shows the crux in code.

### 3. Ask for approval

Use `AskUserQuestion`:

- **Question**: "Approve this proposal and continue to detailed planning?"
- **Options** (only two — "Other" is auto-added by the tool and covers any rejection or change request):
  1. **Yes** — proceed to `dp:plan`. Keep checkpoint prompts active for later steps.
  2. **Yes — Autonomous (no further questions)** — proceed and skip all remaining approval prompts.

### 3.5. CRITICAL — interpret the answer correctly

**Approval is ONLY an explicit "Yes" or "Yes — Autonomous" answer to the AskUserQuestion above.** Nothing else. In particular:

- **Frustrated / rejecting / sarcastic free-text is NEVER approval.** Examples that MUST be treated as rejection + feedback, NOT as a green-light:
  - "I will not read this"
  - "wtf, too long"
  - "this is unreadable"
  - "no, this is bad"
  - "what is this wall of text"
  - "fuck off"
  - Any expletive, any "lol", any visible annoyance.

  Reading any of those as approval is a hard failure of the pipeline. The model MUST go back to step 4 ("Handle the answer" → "Other / free-text feedback"), respond first with what it thinks the user is reacting to (almost always: proposal is lazy / wrong / too long / unclear / wrong shape), and ask via AskUserQuestion how to fix the proposal.

- **Quiet agreement like "looks good" or "ok proceed"** counts as Yes (non-autonomous) — but re-issue the AskUserQuestion to lock the choice cleanly and record `approvalMode` correctly.

- **When in doubt, do NOT assume approval.** Re-ask. Never advance state.json on ambiguous input.

### 4. Handle the answer

- **Yes**: continue to step 5.
- **Yes — Autonomous**: also run `bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> autonomous true`. Continue. --session "<DP_SESSION_ID>"
- **Other / free-text feedback** — this is a **dialog**, not a command queue. Do NOT silently apply the feedback and reprint. Procedure:

  1. **Carefully re-read** the feedback. Treat every word as intentional.

  2. **Respond first, before touching anything.** Acknowledge the feedback and give your honest assessment in 1–3 short paragraphs. Pick the case that fits:
     - **You agree it's sound.** Say so briefly and why. "Good point — X keeps the result component dumb, simpler to test."
     - **You see a tradeoff worth flagging.** Voice it. "I can switch to X, but it means Y. If you're OK with that, I'll update."
     - **You think it's a bad idea.** Push back, briefly. "I'd hesitate — that'd reintroduce <problem>. Alternative: <Z>. Want me to do it your way anyway, or try Z?"
     - **You don't fully understand the feedback.** Ask one clarifying question — never assume.

     The goal: the user wants to know that the model thought about the feedback, not blindly followed it.

  3. **If you raised concerns or asked a question, STOP and wait for the user's next answer.** Do not patch the proposal yet. The next user message will redirect or confirm.

  4. **Once aligned** (or if you had no hesitation in step 2):
     - **If feedback added new details** about the feature itself (clarifications, additional related files, new constraints, scope changes) — patch `<RUN_DIR>/context.md` in place. Append to the relevant section (Feature explanation / Related files / Risks & unknowns). Never silently drop user-provided detail.

  5. **Print the updated proposal in full** using the same section format from step 2 (including 1.5 if and only if it's a bug). Don't print a diff or "what changed" note — reprint the whole thing.

  6. Loop back to step 3 (ask for approval again).

### 5. Mark step done and advance

Record the approval mode and advance:

```
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-proposal.approvalMode '"yes"' --session "<DP_SESSION_ID>"
# or '"yes-autonomous"' if option 2 was chosen
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-proposal.approvedAt '"<ISO timestamp>"' --session "<DP_SESSION_ID>"
bun ${DP_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> plan-proposal --session "<DP_SESSION_ID>"
```

### 6. Hand off to `dp:plan` — do not text-stop

The plugin's Stop hook gates progression on Claude Code (hard block while `steps.plan.status === "pending"`) and auto-prompts the next skill on Cursor (soft auto-submit). Either way, advancing state.json correctly is mandatory.

Print a one-liner first: "Proposal approved — drafting the detailed plan now."

**On Claude Code**: your very next action MUST be a Skill-tool invocation in this same turn:

```
Skill(skill_name = "dp:plan")
```

**On Cursor**: there is no Skill tool — end your turn after the one-liner. The plugin's `stop` hook will auto-submit `/plan` as a follow-up turn, triggering the next skill via slash-prefix auto-discovery.

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

### 1. Mark step as running

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-proposal.status running
```

### No shortcuts — always propose the thorough solution

When you have two plausible approaches — a quick-and-dirty patch versus a slower fix that also tidies related code, removes duplication, or extends a small refactor — **always propose the thorough one**. Not the lazy one. Not "the minimal change". Not "the smallest diff".

Rationale: the user will reject a shortcut and ask for the proper fix anyway. Proposing the shortcut wastes a full proposal cycle. Propose the version that handles everything, including:

- Removing the duplication that the change reveals.
- Extracting a one-time-used helper into a common place if a second caller now needs it.
- Updating call sites consistently rather than patching one and leaving a divergent shape elsewhere.
- Cleaning up adjacent code that the change touches.

If the user explicitly asks for "the minimal diff" or "just patch this one place" in their original request, follow that instruction — but say so in section 1 (User request) so the deviation is visible.

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
<2–4 short paragraphs, separated by blank lines, describing what you plan to do — in key words and at a level the user can quickly scan.

For bug fixes: the diagnosis already lives in section 1.5; this section is purely the fix. For features/refactors: this is the meat of the proposal. Each paragraph should describe a chunk of the plan: what to add/change/remove, what the user-visible result will be, and what's deliberately out of scope.>

### 3. Technical approach
- <one bullet per key technical DECISION; ≤ 1 line each>
- <5–8 bullets max>
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

- **One idea per paragraph. Bigger separation is better.** Each distinct point — what you'll change, why, what the user-visible result is, what's out of scope — gets its own paragraph with a blank line between. Do not bundle two ideas into one paragraph just because they relate. When in doubt, split.
- **No fixed count.** Include every key point the user needs to evaluate the plan. If a real proposal has 8 distinct points, write 8 paragraphs. Never drop a key detail to hit a length target.
- **No bloat either.** Each paragraph carries information. No padding sentences, no restating section 1, no "as mentioned above". If a paragraph isn't adding a new key point, delete it.
- Always insert a blank line between paragraphs — never produce one giant lump.
- Plain prose, no bullets, no headers, no inline lists with commas pretending to be a list.
- Describes **what you'll do** and the user-visible behavior change. For bug fixes, the diagnosis is in 1.5 — this section is purely the fix.

**Anti-example for a bug fix — root cause was missing AND section 2 was filled with diagnosis prose:**

> ### 2. Plan proposal
> The demo safety-routine cron on sandbox is spamming retry warnings (`submitForm.fileUpload: unable to run execution in global scope in server context`) and the uploads ultimately fail. Root cause is a single line in `uploadWithSystemIdentity` that opens a fresh execution scope with type `'client'`. The server-side scope executor hard-throws on `'client'` and `'global'` — only `resolver/http/job/lambda` are permitted. The CLI seed never tripped this because the CLI doesn't initialize the server scope executor at all.

Three paragraphs of cause, zero paragraphs of plan, and 1.5 was missing.

**Correct shape for the same bug-fix proposal — 1.5 holds the diagnosis, 2 holds the fix:**

> ### 1.5. Root cause
> `uploadWithSystemIdentity` opens a fresh execution scope of type `'client'`. The server-side scope executor (API server + Bull worker) hard-throws on `'client'`/`'global'` — only `resolver/http/job/lambda` are allowed. CLI silently accepted it via a permissive default-executor, which is why it wasn't caught.
>
> ### 2. Plan proposal
> Switch the scope type used by `uploadWithSystemIdentity` from `'client'` to a server-permitted type (likely `'job'`) so the Bull-cron and API-server paths can run it without throwing. CLI behavior is unchanged because the CLI bypasses scope validation entirely.
>
> Out of scope: refactoring `withRetry` so it doesn't blindly retry programmer errors, and any cleanup of the `'client'`/`'global'` taxonomy itself.

**Technical approach rules — every bullet must satisfy ALL of these:**

- One line. If it wraps, you're packing too much in. Split or cut.
- A **decision**, not an implementation note. ("Use limit/offset pagination" is a decision. "Add `pageSize` and `pageToken` to the new `GET /api/foo` endpoint, with `pageSize` defaulting to 20…" is a plan.)
- No file paths, no function names, no signatures, no parameter lists.
- No "asset gaps", "TODOs", "later", "out of scope unless you say otherwise" — those are plan-territory.
- No prose paragraphs. No nested sub-bullets.

If you find yourself writing more than ~80 chars on a bullet, ask: "is this a *decision* or am I writing the plan?" — and cut.

**Anti-example (do NOT produce this) for technical approach:**

> Extend `ResultPanel` props with `selectedItemId?: string` and `mode?: PanelMode` (or just pass `items: Item[]` already-resolved from the parent — leaner; lookup stays in the container). Choose the leaner option: parent resolves items via `getItemsFor(selectedItemId ?? fallback, { flagA, flagB })` and passes `previewItems={items}`. Component remains dumb.

That belongs in `plan.md`, not the proposal. Equivalent proposal-bullet:

> - Parent resolves the items per selection; the result component stays dumb.

Use that level of compression for technical approach.

### 3. Ask for approval

Use `AskUserQuestion`:

- **Question**: "Approve this proposal and continue to detailed planning?"
- **Options**:
  1. **Yes** — proceed to `dp:plan`. Keep checkpoint prompts active for later steps.
  2. **Yes — Autonomous (no further questions)** — proceed AND set `state.autonomous = true`. Later steps will not prompt for approval.
  3. **No, change** — capture feedback. (User is given an "Other" option to type free-text feedback.)

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

  Reading any of those as approval is a hard failure of the pipeline. The model MUST go back to step 4 ("Handle the answer" → "No / Other"), respond first with what it thinks the user is reacting to (almost always: proposal is lazy / wrong / too long / unclear / wrong shape), and ask via AskUserQuestion how to fix the proposal.

- **Quiet agreement like "looks good" or "ok proceed"** counts as Yes (non-autonomous) — but re-issue the AskUserQuestion to lock the choice cleanly and record `approvalMode` correctly.

- **When in doubt, do NOT assume approval.** Re-ask. Never advance state.json on ambiguous input.

### 4. Handle the answer

- **Yes**: continue to step 5.
- **Yes — Autonomous**: also run `bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> autonomous true`. Continue.
- **No / Other (with feedback)** — this is a **dialog**, not a command queue. Do NOT silently apply the feedback and reprint. Procedure:

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
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-proposal.approvalMode '"yes"'
# or '"yes-autonomous"' if option 2 was chosen
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.plan-proposal.approvedAt '"<ISO timestamp>"'
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> plan-proposal
```

### 6. Hand off — INVOKE `dp:plan`, do not text-stop

The plugin's Stop hook will block your turn while `steps.plan.status === "pending"`. Your very next action must be:

```
Skill(skill_name = "dp:plan")
```

A one-line "Proposal approved — drafting the detailed plan now." is fine before the call, but the Skill invocation MUST happen in this same turn.

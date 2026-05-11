---
name: plan-proposal
description: Use when an active dev-pipeline run is at the plan-proposal step. Prints a short two-section proposal (scope + technical approach) for fast user feedback before any plan file is written. Loops on feedback until approved.
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

### 2. Print the proposal in chat — exactly two sections, distinct shapes

The proposal must be **scannable in under 30 seconds**. The user reviews it to redirect approach BEFORE you spend effort on a detailed plan. If they can't quickly read it, you've defeated the purpose of this gate.

```
## Proposal — <feature name>

### 1. Scope summary
<2–4 short paragraphs, separated by blank lines. NOT one wall of text. NOT bullets.>

<Paragraph 1: what the feature is in plain prose.>

<Paragraph 2: key user-visible behavior decisions.>

<Optional paragraph 3: out of scope (one short paragraph, not a list).>

### 2. Technical approach
- <one bullet per key technical DECISION; ≤ 1 line each>
- <5–8 bullets max>
```

**Scope summary rules:**

- **Scope summary must use paragraphs for better readability.** Not one wall of prose, not bullets — separate paragraphs the user can scan one at a time.
- 2–4 short paragraphs (3–5 sentences each MAX).
- Always insert a blank line between paragraphs — never produce one giant lump.
- Plain prose, no bullets, no headers, no inline lists with commas pretending to be a list.
- Describes the feature and user-visible behavior. NOT implementation.

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

  5. **Print the updated proposal in full** using the same two-section format from step 2. Don't print a diff or "what changed" note — reprint the whole thing.

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

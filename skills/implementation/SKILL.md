---
name: implementation
description: Use when an active dev-pipeline run is at the implementation step. Generates todos from plan.md, implements them one-by-one, and runs typecheck + lint at the end. Strict-typing rules (no `any`, no dirty `as`) are self-policed by the skill and verified by the project's lint.
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash(bun *)
  - Bash(yarn *)
  - Bash(npm *)
  - Bash(pnpm *)
  - Bash(npx *)
  - Bash(git *)
  - TodoWrite
  - AskUserQuestion
---

# dp:implementation

Implement the approved plan. The plugin's plugin-wide Stop hook (`enforce-pipeline-progress.ts`) blocks completion of this step until `steps.implementation.checksPassed === true`.

## Inputs

- `RUN_DIR` — run directory.
- `<RUN_DIR>/plan.md` — the approved plan.

## Procedure

### 1. Mark running

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.implementation.status running
```

### 2. Generate todos from `plan.md`

Read the plan's "File-by-file changes" section. Create one `TodoWrite` task per file (or per logically grouped change). Add these final tasks at the end:

- "Run typecheck"
- "Run lint"
- "Fix any errors and re-run typecheck + lint"
- "Mark implementation checks passed"

### 3. Execute todos one by one

Work each todo to completion. Make changes via `Edit` / `Write`.

**Hard rules — self-policed while editing, then verified by the project's lint + typecheck in step 4:**

- **No `: any` annotations.** Use a precise type, `unknown` + a narrowing check, or a generic. If you genuinely cannot infer the right type, stop and ask the user via `AskUserQuestion` (skip if `autonomous`).
- **No bare `as <Type>` casts.** Prefer `satisfies`. If a cast is genuinely necessary (rare), append `// safe-cast: <one-line reason>` to the same line. Static-analysis enforcement is the responsibility of the project's lint config — if the project doesn't lint these, suggest adding rules (`@typescript-eslint/no-explicit-any`, `@typescript-eslint/consistent-type-assertions`) and ask the user once whether to add them.

### 4. Run typecheck and lint

Detect the project's commands by reading `package.json`:

- TypeScript: `yarn typecheck` / `npm run typecheck` / `tsc --noEmit` (whichever script exists).
- Lint: `yarn lint` / `npm run lint` / `eslint .` (whichever script exists).

If neither exists, ask the user once via `AskUserQuestion` what the project's typecheck/lint commands are (skip if `autonomous`).

If errors appear: fix them in place, then re-run. Loop until both pass clean.

### 5. Mark checks passed

Only after both typecheck and lint exit zero with no errors:

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts set <RUN_DIR> steps.implementation.checksPassed true
```

If you skip this, the plugin-wide Stop hook will block your next response with a corrective message — fix it and try again.

### 6. Advance

```
bun ${CLAUDE_PLUGIN_ROOT}/scripts/cli/advance.ts advance <RUN_DIR> implementation
```

### 7. Hand off — INVOKE `dp:codereview`, do not text-stop

The plugin's Stop hook will block your turn while `steps.codereview.status === "pending"`. Your very next action must be:

```
Skill(skill_name = "dp:codereview")
```

Before the Skill invocation, print a one-liner referencing the run dir as a **markdown link** (artifacts live there for inspection):

```
Implementation complete — typecheck + lint pass. Run dir: [.claude/feature-pipeline/<feature>/](.claude/feature-pipeline/<feature>/). Running codereview now.
```

The Skill invocation MUST still happen in this same turn.

# claude-dev-pipeline-plugin

A Claude Code plugin (`dp` namespace) that turns feature work into an explicit, resumable, hook-enforced pipeline.

```
investigation → plan-proposal → plan → plan-improve → plan-improve-apply
              → plan-wrapup → implementation → codereview
```

State lives in your project at `.claude/feature-pipeline/<feature>/`. Artifacts (`context.md`, `plan.md`, `review.md`, `state.json`) are plain files you can read, diff, and commit.

## Quick start (end users)

```
/plugin marketplace add kostia-official/claude-dev-pipeline-plugin
/plugin install dp@kostia-official-claude-dev-pipeline-plugin
```

Then in any project:

```
/dp:dev-pipeline rewrite auth to use refresh tokens
```

To resume:

```
/dp:dev-pipeline continue auth-rewrite
# or pass the path directly:
/dp:dev-pipeline .claude/feature-pipeline/auth-rewrite/
```

To see the current state, just ask in chat — "what's the state of my pipeline run?" — Claude reads `state.json` and answers.

To upgrade later:

```
/plugin marketplace update claude-dev-pipeline-plugin
/reload-plugins
```

### Soft dependency

`dp:codereview` wraps `/simplify` from Anthropic's official `code-simplifier` plugin. If you don't have it:

```
/plugin marketplace add anthropics/claude-plugins-official
/plugin install code-simplifier
```

If you skip this, `dp:codereview` falls back to running the simplification review itself.

### Runtime prerequisite

The plugin's hooks and CLI scripts run on **Bun**. Install once:

```
brew install bun
# or
curl -fsSL https://bun.sh/install | bash
```

## What the pipeline does

| Step | Skill | Output | Gate |
|---|---|---|---|
| 1 | `dp:investigation` | `context.md` | — |
| 2 | `dp:plan-proposal` | (chat only) | User approves: Yes / Yes-Autonomous / No |
| 3 | `dp:plan` | `plan.md` | — |
| 4 | `dp:plan-improve` | `review.md` | — |
| 5 | `dp:plan-improve-apply` | patched `plan.md` | Per-issue questions if direction unclear |
| 6 | `dp:plan-wrapup` | finalised `plan.md` | User approves: Approve / Edit / Reject |
| 7 | `dp:implementation` | code changes | Self-policed by the skill (no `: any`, no dirty `as` — backed by lint); Stop hook blocks completion until typecheck + lint have passed |
| 8 | `dp:codereview` | review notes + diff | `Promise.all` opportunities are reported, never auto-applied |

The pipeline can run with checkpoints (default) or fully autonomous (pick "Yes — Autonomous" at the proposal gate).

### Hook enforcement (implementation step only)

One hook is scoped to `dp:implementation` — it fires **only** while that skill is active:

- **Stop**: blocks finishing the implementation step until typecheck + lint have been recorded as passing.

The skill body also instructs Claude to never introduce `: any` or dirty `as <Type>` casts — those rules are about *what code Claude writes*, not about runtime behaviour, so they belong in skill instructions and the project's lint config (e.g. `@typescript-eslint/no-explicit-any`), not in a static-analysis hook.

Outside the implementation step, normal Edit/Write/Stop are completely untouched.

## Working on the plugin itself

Develop directly against the source tree at `~/projects/claude-dev-pipeline-plugin/`:

```bash
# Option A — start a session pointing Claude Code at the source tree:
cd <any-project>
claude --plugin-dir ~/projects/claude-dev-pipeline-plugin

# Option B — install the local clone as a plugin (persists across sessions):
/plugin install ~/projects/claude-dev-pipeline-plugin
```

Then in chat:

```
/dp:improve <free-text feedback about the plugin>
```

`dp:improve` will identify the right file, preview the diff, apply, bump `version` in `.claude-plugin/plugin.json`, and create a single-purpose git commit. It refuses to run against a marketplace cache install — fork and clone first.

### Publishing updates

1. Make changes (manually or via `dp:improve`).
2. Push: `git push`.
3. Tag the release: `git tag v$(jq -r .version .claude-plugin/plugin.json) && git push --tags`.

End users update via:

```
/plugin marketplace update claude-dev-pipeline-plugin
/reload-plugins
```

(Or enable auto-update for that marketplace in `/plugin > Marketplaces`.)

## File layout

```
claude-dev-pipeline-plugin/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── commands/
│   └── dev-pipeline.md          # /dp:dev-pipeline
├── skills/
│   ├── investigation/SKILL.md
│   ├── plan-proposal/SKILL.md
│   ├── plan/SKILL.md
│   ├── plan-improve/SKILL.md
│   ├── plan-improve-apply/SKILL.md
│   ├── plan-wrapup/SKILL.md
│   ├── implementation/SKILL.md  # ships skill-scoped hooks
│   ├── codereview/SKILL.md
│   └── improve/SKILL.md
├── scripts/
│   ├── lib/{state.ts,findRun.ts}
│   ├── cli/{advance.ts,status.ts}
│   └── hooks/enforce-final-checks.ts
└── README.md
```

## State schema

`<consumer-project>/.claude/feature-pipeline/<feature>/state.json`:

```json
{
  "name": "auth-rewrite",
  "createdAt": "...",
  "active": true,
  "autonomous": false,
  "currentStep": "plan",
  "steps": {
    "investigation":      { "status": "done", "artifact": "context.md" },
    "plan-proposal":      { "status": "done", "approvalMode": "yes" },
    "plan":               { "status": "running", "artifact": "plan.md" },
    "...":                "..."
  },
  "args": "rewrite auth to use refresh tokens"
}
```

## License

MIT

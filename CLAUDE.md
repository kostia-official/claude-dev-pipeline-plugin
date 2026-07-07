# CLAUDE.md — claude-dev-pipeline-plugin

Guidance for working on this plugin.

## Publishing / releasing — do NOT equate `git push` with publishing

**"Publishing a Claude Code plugin" is a distinct act from `git push` or `npm publish`.** Those only move bytes to a host/registry; the plugin becomes *published* when consumers can install/update it via a **marketplace**. Never answer "just git push" when asked how to publish.

This repo is a self-hosted GitHub marketplace (ships both `.claude-plugin/` and `.cursor-plugin/`). Release flow:

1. **Bump `version` in all four manifests in lockstep**: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (top-level **and** `plugins[0].version`), `.cursor-plugin/plugin.json`, `.cursor-plugin/marketplace.json` (`metadata.version`). `dp:improve` automates this. Versions are **pinned** — consumers get nothing until the string changes.
2. `git push` (updates the GitHub-hosted catalog + source).
3. `claude plugin tag --push` from the repo root — creates the `dp--v<version>` release tag (the convention Claude Code's version resolver uses). Do NOT hand-create a plain `v<version>` tag; wrong format.

Consumers update with `/plugin marketplace update claude-dev-pipeline-plugin` + `/reload-plugins`. **Auto-update is OFF by default for third-party marketplaces; the publisher cannot force it** (consumer toggles it, or an org admin sets `autoUpdate: true` in managed `extraKnownMarketplaces`).

**Non-git publish alternatives** (a plugin need not use git): npm source (`npm publish` + `{"source":"npm"}` entry), org-marketplace ZIP upload in claude.ai, or community-directory submission at `clau.de/plugin-directory-submission`.

**Local dev:** this plugin is registered here as a `directory`-source marketplace (loads straight from the working tree); `/reload-plugins` picks up edits with no push.

## Versioning

- SemVer: PATCH for fixes, MINOR for new skills/capabilities, MAJOR for removed/renamed skills or breaking state/hook changes.
- All four manifest version fields must always match.

## Conventions

- Do not add `Co-Authored-By` lines to commits. Commit only when explicitly asked.
- Keep skill docs scannable; describe repeated patterns once instead of enumerating every case.

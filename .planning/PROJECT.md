# codereview — Agent Team Support

## What This Is

A CLI tool that reviews GitHub pull requests using Claude. Currently runs a single Claude session per review. The next milestone adds parallel agent team support so that four specialized agents (security, performance, code quality, test coverage) review different aspects of a PR simultaneously, producing findings grouped by aspect.

## Core Value

Every PR gets thorough, multi-dimensional review coverage by running specialized agents in parallel — catching issues that a single-pass review misses.

## Requirements

### Validated

- ✓ Quick review mode (API diff → single Claude call → findings) — existing
- ✓ Deep review mode (clone repo → agentic Claude session → findings) — existing
- ✓ GitHub PR data fetching via Octokit (metadata, files, diff) — existing
- ✓ Review posting to GitHub as PENDING draft reviews — existing
- ✓ HTML report generation with inline annotations — existing
- ✓ Terminal output with severity-sorted findings (picocolors) — existing
- ✓ Review mode overlays (strict/detailed/lenient/balanced) — existing
- ✓ Security model: input validation, credential scrubbing, env filtering, clone safety — existing
- ✓ Prerequisite checking (gh CLI, claude CLI) — existing
- ✓ Diff parsing for inline comment routing — existing
- ✓ URL parsing for GitHub PR URLs — existing
- ✓ Fallback: deep mode fails → automatic quick mode fallback — existing

### Active

- [ ] Parallel agent teams: spin up 4 specialized Claude Code agents per review using the agent teams API
- [ ] Four fixed review aspects: security, performance, code quality, test coverage
- [ ] Agent teams work in both quick and deep review modes
- [ ] Findings grouped by aspect in terminal output, GitHub comments, and HTML reports
- [ ] Use Claude Code's experimental agent teams feature (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)
- [ ] Lead agent synthesizes and deduplicates findings across aspect agents
- [ ] Graceful degradation if agent teams unavailable (fall back to single-agent review)

### Out of Scope

- Configurable aspect selection (--aspects flag) — fixed four aspects is simpler, revisit if users request
- User-facing agent team display modes (tmux/split panes) — this is a non-interactive CLI tool
- Inter-agent debate/challenge patterns — agents review independently, lead synthesizes
- Custom aspect definitions — no plugin system for defining new review aspects
- Agent-per-file parallelism — aspects are the unit of parallelism, not files

## Context

The tool currently invokes Claude via `claude -p` (quick mode) and `claude` with `spawn` + streaming (deep mode). Both are subprocess calls with argument arrays (`execFile`/`spawn`).

Agent teams are an experimental Claude Code feature that coordinates multiple Claude Code instances. One session acts as team lead, spawning teammates that work independently with their own context windows. Unlike subagents (which report back to caller), teammates can communicate directly.

The key integration challenge: the current tool runs Claude non-interactively as a subprocess. Agent teams need to be orchestrated programmatically — either by having the lead session's prompt instruct it to create a team, or by spawning multiple `claude` subprocesses ourselves that coordinate through the agent teams mechanism.

The codebase has a strict 4-dependency budget (commander, @octokit/rest, zod, picocolors) and uses only `execFile`/`spawn` for subprocesses.

**Codebase map:** `.planning/codebase/` (7 documents, mapped 2026-03-05)

## Constraints

- **Dependencies**: Must stay within the 4-runtime-dependency budget. Agent team orchestration uses subprocess calls, not new npm packages.
- **Security**: All subprocess calls must use `execFile`/`spawn` with argument arrays. No `exec()` with string interpolation. Credential scrubbing applies to all agent output.
- **ESM only**: All new code uses `import`/`export`.
- **No emoji**: Professional code review output — no emoji in findings or terminal output.
- **Subprocess model**: Claude invoked via `execFile`/`spawn`. Environment filtered via `filterEnv()`.
- **Experimental feature**: Agent teams require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Must handle gracefully when not available.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use Claude Code agent teams API (not DIY parallel subprocesses) | User preference; leverages built-in coordination, task list, messaging | — Pending |
| Always parallel (no opt-in flag) | Simpler UX; parallel is always better for review quality | — Pending |
| Fixed four aspects (security, performance, quality, tests) | Covers the key review dimensions without configuration complexity | — Pending |
| Findings grouped by aspect (not merged flat) | Makes it clear which dimension surfaced each finding | — Pending |
| Graceful fallback to single-agent if teams unavailable | Don't break existing workflow for users without experimental feature | — Pending |

---
*Last updated: 2026-03-05 after initialization*

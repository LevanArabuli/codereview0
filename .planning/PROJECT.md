# codereview

## What This Is

An AI-powered CLI tool that reviews GitHub pull requests using Claude. Takes a PR URL, fetches the diff and metadata via the GitHub API, sends it to Claude for analysis, and returns structured review findings as inline GitHub comments, terminal output, and HTML reports. Two review modes: quick (diff-only) and deep (clones repo for agentic analysis).

## Core Value

Produce code review feedback that's as useful as a senior engineer's review — context-aware, well-prioritized, and focused on what actually matters.

## Requirements

### Validated

- ✓ Parse GitHub PR URLs and fetch PR data (metadata, diff, file list) — existing
- ✓ Quick review mode: analyze diff with Claude via single prompt — existing
- ✓ Deep review mode: clone repo, run agentic Claude analysis with full codebase access — existing
- ✓ Review mode overlays (strict/detailed/lenient/balanced) — existing
- ✓ Post findings as PENDING GitHub review with inline comments — existing
- ✓ Terminal output with severity-sorted findings — existing
- ✓ HTML report generation with inline annotations — existing
- ✓ Security hardening: input validation, credential scrubbing, env filtering, push prevention — existing
- ✓ Prerequisite checks for gh and claude CLI tools — existing
- ✓ Diff-line validation for accurate inline comment placement — existing
- ✓ Off-diff findings grouped into review body — existing
- ✓ Evaluation infrastructure for fixture-based review quality testing — existing

### Active

- [ ] Context-aware reviews: understand codebase patterns and conventions before reviewing
- [ ] Intent-aware reviews: understand what the PR is trying to accomplish and review against that goal
- [ ] Severity calibration: distinguish real bugs from logic issues from design concerns from style nits
- [ ] Confidence scoring: each finding includes how confident the reviewer is, reducing false positives
- [ ] Low-value finding suppression: filter out obvious nits, surface only findings worth human attention
- [ ] Better quick mode prompting: produce more specific, contextual feedback from just the diff
- [ ] PR-aware context gathering: analyze what the PR touches, pull in related files/tests/patterns
- [ ] Pre-analysis codebase convention detection for deep mode

### Out of Scope

- Interactive terminal UI — CLI tool, not TUI
- Webhook/bot mode or GitHub Actions integration — CLI-first
- Auto-approve, auto-merge, or request-changes verdicts — human makes final call
- Syntax highlighting in HTML reports — no highlight.js
- Adding runtime dependencies beyond strong justification — maintain 4-dep budget
- Review tone/phrasing changes — focus is on judgment quality, not writing style

## Context

The tool works end-to-end today. The problem is review quality: findings are too generic (could apply to any codebase) and miss context (don't understand the broader codebase patterns when reviewing a PR). The deep mode clones the repo but Claude isn't guided to study relevant patterns before reviewing. Quick mode only sees the diff with no surrounding context.

The key improvement is **judgment** — knowing when something is actually a problem vs. when it's fine. This manifests as better severity calibration, confidence scoring, and suppression of low-value noise.

Architecture is a flat pipeline CLI (17 ESM modules under src/). The prompt construction layer (`src/prompt.ts`) and analysis layer (`src/analyzer.ts`) are the primary targets for improvement. The schema layer (`src/schemas.ts`) needs updates to support confidence scores.

Security model is non-negotiable: execFile with arg arrays, credential scrubbing, env filtering, read-only API surface, structural push prevention. All changes must preserve these invariants.

## Constraints

- **Dependencies**: Maximum 4 runtime dependencies (commander, @octokit/rest, zod, picocolors). No new runtime deps without strong justification.
- **Security**: All security invariants in SECURITY.md must be preserved. No exec(), no shell interpolation, always scrub credentials.
- **ESM only**: All code uses import/export, never require() (exception: createRequire for JSON fixtures in tests).
- **Node >= 22**: Target ES2022, module NodeNext.
- **Zod 4**: Schema validation uses Zod v4.
- **No emoji**: GitHub comments and terminal output avoid emoji.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep current output format | Users want better content, not different structure. Inline comments + HTML report stay. | — Pending |
| Improve both quick and deep modes | Most improvement potential is in deep mode, but quick mode is used more often | — Pending |
| Focus on judgment over tone | The human quality gap is about knowing what matters, not about phrasing | — Pending |

---
*Last updated: 2026-03-04 after initialization*

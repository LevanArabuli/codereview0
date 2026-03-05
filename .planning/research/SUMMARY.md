# Project Research Summary

**Project:** codereview0 — Claude Code Agent Teams Integration
**Domain:** CLI tool with parallel multi-agent code review
**Researched:** 2026-03-05
**Confidence:** HIGH

## Executive Summary

This milestone adds parallel multi-agent review to an existing, production-quality single-agent CLI code review tool. The core value proposition is four independently specialized review agents (security, performance, code quality, test coverage) running in parallel and producing aspect-tagged, deduplicated findings. Research across all four areas converges on a single decisive finding: **the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` API cannot be used from a non-interactive subprocess context** (confirmed via GitHub issue #29293, closed as duplicate). The correct integration pattern is DIY parallel subprocesses — four independent `claude -p` invocations via `Promise.allSettled()` — which is architecturally consistent with the existing codebase, fits within the 4-dependency budget, and delivers identical parallelism without experimental API risk.

The recommended approach is entirely additive to the existing codebase. Three new modules (`team-analyzer.ts`, `team-prompt.ts`, `finding-merger.ts`) handle the parallel orchestration. The existing `analyzer.ts`, `cloner.ts`, `github.ts`, and security infrastructure (`filterEnv()`, `scrubSecrets()`) are unchanged. The only schema change required is an optional `aspect` field on `ReviewFindingSchema`. Existing single-agent review paths remain the fallback and are preserved without modification.

The primary risks are: token cost explosion (4x vs. single agent, potentially 7x in plan mode), credential leakage through the multi-agent subprocess boundary (the `ANTHROPIC_BASE_URL` CVE-2026-21852 is directly relevant), and deduplication quality depending on prompt engineering rather than structural guarantees. All three are addressable — cost through model defaults (Sonnet for aspect agents), credentials through explicit `filterEnv()` extension, deduplication through both prompt design and code-level post-processing in `finding-merger.ts`.

---

## Key Findings

### Recommended Stack

The existing stack (TypeScript, Node.js 22+, `spawn`/`execFile`, four runtime dependencies) requires no changes for this milestone. The integration is entirely within the existing subprocess model.

The central stack decision — agent teams API vs. DIY parallel subprocesses — is resolved by a confirmed bug: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` does not spawn teammates when the lead is invoked non-interactively via `claude -p`. Setting this env var in a subprocess context causes it to run as a single-agent session without warning. DIY parallel subprocesses via `Promise.allSettled()` is the only viable approach for a non-interactive CLI caller.

**Core technologies:**
- `spawn('claude', ['-p', aspectPrompt], { env: filterEnv() })`: parallel subprocess invocation — same model used by the current deep review, extended to four concurrent calls
- `Promise.allSettled()`: fan-out orchestration — preferred over `Promise.all()` so one failing aspect does not abort the entire review
- `filterEnv()` (existing): security boundary — must be extended to explicitly include `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` when wanted, strip `ANTHROPIC_BASE_URL` (CVE-2026-21852)
- No new runtime dependencies — 4-dep budget maintained

### Expected Features

**Must have (table stakes — P1):**
- Parallel execution of four specialized aspect agents (security, performance, code quality, test coverage) — the core value proposition
- Lead-side deduplication of cross-aspect findings — without it, the same bug appears four times
- Graceful degradation to single-agent when team mode fails or is unavailable — must be explicit with a user-visible message, not silent
- `aspect` field on `ReviewFindingSchema` — blocks all grouped output; cannot be deferred
- Terminal output grouped by aspect with section headers — minimum expected experience
- Integration with both quick mode and deep mode — both paths must produce the same `ReviewFinding[]` shape

**Should have (competitive — P2):**
- GitHub review comments grouped by aspect section headers
- HTML report with aspect sections
- Per-agent cost and duration in `--verbose` mode (each aspect agent's `AnalysisMeta`)

**Defer (v2+):**
- Configurable aspect selection (`--aspects` flag) — adds CLI surface area; fixed four is the correct default
- Aspect-level mode overlays (e.g., `--mode strict` only for security agent)
- Inter-agent debate/challenge patterns — high token cost, complex convergence, out of scope per PROJECT.md

### Architecture Approach

The architecture is a fan-out/fan-in pattern: `cli.ts` invokes `team-analyzer.ts`, which fans out to four parallel `claude -p` subprocesses (one per aspect), collects results via `Promise.allSettled()`, then fans in to `finding-merger.ts` for deduplication before handing off to existing output modules (`output.ts`, `review-builder.ts`, `html-report.ts`). All existing module contracts are preserved. The team path is additive, not a replacement.

**Major components:**
1. `team-analyzer.ts` (new) — parallel subprocess orchestrator; invokes `analyzeAspect()` four times concurrently; uses `Promise.allSettled()` for partial failure resilience
2. `team-prompt.ts` (new) — aspect-specific prompt builders; extends the existing `buildPrompt()` base with focus instructions per aspect
3. `finding-merger.ts` (new) — deduplication and aspect grouping; compares findings by (file, line, message) tuples; produces `FindingsByAspect` for downstream consumers
4. `types.ts` / `schemas.ts` (extend) — add `ReviewAspect`, `AspectResult`, `FindingsByAspect` types; add optional `aspect` field to `ReviewFindingSchema`
5. `output.ts` / `review-builder.ts` / `html-report.ts` (extend) — aspect-grouped rendering in terminal, GitHub, and HTML outputs

**Build order:** types → schemas → team-prompt → team-analyzer → finding-merger → output extension → review-builder extension → html-report extension → cli.ts wiring

### Critical Pitfalls

1. **Agent teams incompatible with non-interactive subprocess** — Do not use `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` with `claude -p`; it silently runs as single-agent. Use DIY parallel subprocesses exclusively. Validate with a controlled spike before any integration code is written.

2. **Token cost explosion without user awareness** — Four parallel aspect agents cost 4-7x a single review. Default all aspect agents to Sonnet, not Opus. Print an estimated cost multiplier before starting a team review. Set lower `--max-turns` per aspect agent than the full review default.

3. **Credential leakage through teammate env boundary** — `ANTHROPIC_BASE_URL` (CVE-2026-21852) can redirect API traffic. Add it to `filterEnv()`'s `DANGEROUS_EXACT` blocklist. Never use `--dangerously-skip-permissions` with team reviews. Add a security test to `security.test.ts` covering the multi-agent env boundary.

4. **Output aggregation is not structurally guaranteed by prompt alone** — Add `aspect` field to schema before writing any integration code; add code-level deduplication in `finding-merger.ts` as a safety net alongside prompt-level dedup instructions. Test with a PR that two agents would both identify the same issue.

5. **Graceful degradation requires explicit detection, not assumption** — Treat `CODEREVIEW_DISABLE_TEAMS=1` (or absence of team capability) as the feature gate. Always print a user-visible message when falling back: "Agent teams unavailable — running single-agent review." Never silently degrade.

6. **Timeout calculation for parallel sessions** — Set a separate, longer timeout for team reviews (20-25 minutes), not 4x the single-agent timeout. Wall-clock time is bounded by the slowest aspect, but rate limits and coordination overhead can exceed expectations. Add per-agent progress indicators to stderr to prevent "appears hung" UX.

---

## Implications for Roadmap

Based on the research, a 3-phase structure is recommended. The order is driven by the foundational risk (the agent teams API bug must be validated before any integration work), the schema dependency (all output modules depend on the `aspect` field), and the additive nature of output extensions.

### Phase 1: Proof-of-Concept Validation and Schema Foundation

**Rationale:** The single highest-risk assumption (agent teams work non-interactively) must be falsified or confirmed before writing integration code. Research already indicates it fails (GitHub issue #29293), so this phase should validate the DIY parallel subprocess approach and establish the schema foundation that all later phases depend on.

**Delivers:** Confirmed DIY parallel subprocess pattern working end-to-end with a real PR; `ReviewAspect`, `AspectResult`, `FindingsByAspect` types; `aspect` field on `ReviewFindingSchema`; aspect-specific prompt templates in `team-prompt.ts`

**Addresses:** Parallel agent execution (P1), `aspect` schema field (P1)

**Avoids:** Building on a broken API assumption; schema migration pain later

**Research flag:** No additional research needed — the DIY subprocess pattern is well-documented. The spike is a 1-2 hour implementation exercise, not a research task.

### Phase 2: Core Parallel Orchestration and Security Hardening

**Rationale:** With validated approach and schema in place, implement `team-analyzer.ts` (the parallel orchestrator), `finding-merger.ts` (deduplication), and security hardening (`filterEnv()` extension for `ANTHROPIC_BASE_URL`, security test coverage). Graceful degradation must be built into this phase, not retrofitted.

**Delivers:** `team-analyzer.ts` with `Promise.allSettled()` fan-out; `finding-merger.ts` with code-level deduplication; extended `filterEnv()` with `ANTHROPIC_BASE_URL` blocklist; security test coverage in `security.test.ts`; graceful fallback to single-agent with user-visible message; timeout configuration for team reviews; per-agent cost capture

**Addresses:** Graceful degradation (P1), lead synthesis and deduplication (P1), credential leakage (critical pitfall), timeout (critical pitfall)

**Avoids:** Silent fallback, credential leakage, cost explosion

**Research flag:** Security test design for multi-agent env boundary may need targeted research into Claude Code's internal subprocess spawn behavior. Plan for a short research spike on what env teammates actually inherit.

### Phase 3: Output Integration and UX Polish

**Rationale:** With findings correctly produced and tagged, extend all output modules to render aspect-grouped results. This phase is the most isolated — all output modules are pure functions of `FindingsByAspect` with no new subprocess concerns. P2 output features (GitHub, HTML) and UX polish (progress indicators, cost warnings) land here.

**Delivers:** `printAspectFindings()` in `output.ts`; aspect-grouped GitHub review body in `review-builder.ts`; aspect sections in `html-report.ts`; per-agent cost/duration in `--verbose` mode; cost multiplier warning before team review starts; progress indicators ("Security agent: done (3 findings)")

**Addresses:** Terminal grouped output (P1), GitHub grouped comments (P2), HTML report sections (P2), per-agent cost reporting (P2), UX pitfalls

**Avoids:** Findings losing aspect attribution in output, "appears hung" UX during team coordination

**Research flag:** Standard output extension patterns — no additional research needed. All three output modules follow established rendering patterns.

### Phase Ordering Rationale

- Schema (`aspect` field) must precede all output modules — this is the single blocking dependency
- DIY subprocess validation must precede `team-analyzer.ts` implementation — avoids building on wrong architecture assumption
- Security hardening belongs in Phase 2 alongside the first subprocess calls, not as a later addition
- Output extensions (Phase 3) are all pure functions and can be developed and tested in isolation; they have no subprocess or security concerns

### Research Flags

Phases needing deeper research during planning:
- **Phase 2:** Multi-agent env boundary behavior — specifically, what environment variables teammates actually inherit from Claude Code's internal spawn vs. the lead subprocess's filtered env. A controlled test or Claude Code source audit is needed before finalizing the `filterEnv()` extension.

Phases with standard patterns (research-phase not needed):
- **Phase 1:** DIY parallel subprocess pattern is well-documented in official Claude Code headless docs and multiple community implementations. The spike is confirmatory, not exploratory.
- **Phase 3:** Output module extensions follow established patterns within the existing codebase. Terminal, GitHub, and HTML rendering are pure functions with no external dependencies.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official Anthropic docs + Claude Code CLI reference; agent teams limitation confirmed via GitHub issue |
| Features | HIGH | Official agent teams docs for table stakes; community implementations corroborate patterns; anti-features well-justified |
| Architecture | MEDIUM-HIGH | DIY parallel pattern verified via official headless docs and community; agent teams headless failure confirmed via GitHub issue #29293; internal teammate env inheritance is inferred, not directly verified |
| Pitfalls | HIGH | CVE-2026-21852 is public, patched, and directly relevant; token cost 7x figure from official costs docs; all other pitfalls corroborated by multiple sources |

**Overall confidence:** HIGH

### Gaps to Address

- **Teammate environment inheritance:** It is not confirmed whether Claude Code teammates (spawned internally by the lead) inherit env from the lead's subprocess or from the original parent process. This gap affects `filterEnv()` design. Resolve with a controlled test during Phase 2.

- **Agent teams non-interactive failure mode:** Research indicates silence (single-agent fallback) rather than an error when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is set in a `claude -p` context. The exact failure signal to detect is not fully documented. Resolve during the Phase 1 spike by observing stream-json output with and without the env var.

- **Per-teammate max-turns limit:** Whether aspect agents respect `--max-turns` when invoked via the DIY subprocess pattern is not explicitly tested in community sources. Confirm during Phase 1 spike.

- **`~/.claude/teams/` and `~/.claude/tasks/` cleanup:** PITFALLS.md notes these directories may persist after team reviews. Whether DIY parallel subprocesses (not using agent teams) create these directories is unknown. Validate during Phase 2 and add cleanup if needed.

---

## Sources

### Primary (HIGH confidence)
- [Official Claude Code agent teams docs](https://code.claude.com/docs/en/agent-teams) — architecture, enable mechanism, limitations, display modes
- [Official Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) — `--teammate-mode`, `--output-format`, all flag definitions
- [Official Claude Code headless/programmatic docs](https://code.claude.com/docs/en/headless) — `-p` flag, `stream-json`, parallel subprocess pattern
- [Official Claude Code costs docs](https://code.claude.com/docs/en/costs) — "approximately 7x more tokens in plan mode"
- [GitHub Issue #29293: Agent Teams fail in headless/print mode](https://github.com/anthropics/claude-code/issues/29293) — confirmed bug, closed as duplicate of #27729
- [RCE and API Token Exfiltration via Claude Code — CVE-2025-59536 / CVE-2026-21852](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/) — `ANTHROPIC_BASE_URL` attack vector
- [Building a C compiler with a team of parallel Claudes — Anthropic](https://www.anthropic.com/engineering/building-c-compiler) — parallel Claude subprocess pattern

### Secondary (MEDIUM confidence)
- [9 Parallel AI Agents That Review My Code (hamy.xyz)](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents) — community parallel review implementation
- [Parallel Code Review Skill (playbooks.com)](https://playbooks.com/skills/dgalarza/claude-code-workflows/parallel-code-review) — community pattern
- [AddyOsmani: Claude Code Swarms](https://addyosmani.com/blog/claude-code-agent-teams/) — community analysis of agent teams architecture
- [Multi-Agent Orchestration: Running 10+ Claude Instances in Parallel (dev.to)](https://dev.to/bredmond1019/multi-agent-orchestration-running-10-claude-instances-in-parallel-part-3-29da) — DIY parallel subprocess pattern
- [Building Agent Teams in OpenCode (dev.to)](https://dev.to/uenyioha/porting-claude-codes-agent-teams-to-opencode-4hol) — agent teams internal implementation analysis
- [From Tasks to Swarms: Agent Teams in Claude Code (alexop.dev)](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/) — community guide

### Tertiary (LOW-MEDIUM confidence)
- [State of AI Code Review Tools 2025 (devtoolsacademy)](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/) — competitive landscape
- [Claude Code's Hidden Multi-Agent System (paddo.dev)](https://paddo.dev/blog/claude-code-hidden-swarm/) — architectural analysis

---

*Research completed: 2026-03-05*
*Ready for roadmap: yes*

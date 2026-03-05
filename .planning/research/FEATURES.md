# Feature Research

**Domain:** Parallel multi-agent CLI code review tool (adding agent team support to an existing single-agent CLI)
**Researched:** 2026-03-05
**Confidence:** HIGH (official Claude Code agent teams docs verified; community patterns corroborated by multiple sources)

---

## Context

This is a **subsequent milestone** on an existing tool. The current tool (quick mode and deep mode single-agent review) is already shipped. The research question is: what does a parallel/multi-agent code review system need to have, and what should it skip?

The tool's constraint set is narrow:
- 4 runtime dependencies maximum (commander, @octokit/rest, zod, picocolors)
- All subprocess calls must use `execFile`/`spawn` with argument arrays — no `exec()`
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is required for the agent teams API
- Output flows to terminal, GitHub PENDING reviews, and HTML reports
- Security model (credential scrubbing, env filtering) applies to all agent output

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features a user expects the moment they run a multi-agent code review. Missing these makes the feature feel broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Parallel execution of specialized agents | The entire value proposition. If agents run sequentially, it is just slower than single-agent | HIGH | Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; lead agent spawns security/performance/quality/tests teammates simultaneously via the agent teams task list |
| Findings grouped by review aspect in terminal output | Users need to understand which dimension surfaced each issue. Flat merged output loses the specialization signal entirely | MEDIUM | Extend `printFindings()` in `output.ts` to accept and render an aspect header before each agent's findings block |
| Lead agent synthesizes and deduplicates across aspects | Without deduplication, the same bug appears four times (once per agent). That is noise, not signal | HIGH | Lead prompt must explicitly instruct merging and deduplication before outputting the final JSON; duplicate detection by file+line+description similarity |
| Graceful degradation when agent teams unavailable | Feature flag (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) may not be set. Tool must not crash; must fall back to existing single-agent flow | MEDIUM | Detect feature availability at startup (check env var); if absent, log a dim notice and proceed with current single-agent path |
| Findings grouped by aspect in GitHub review comments | When the review is posted to GitHub, aspect sections help reviewers triage — security issues first, then quality, etc. | MEDIUM | Extend `buildReviewBody()` in `review-builder.ts` to accept aspect-tagged findings and emit section headers |
| Findings grouped by aspect in HTML report | The HTML report is the richest artifact. Aspect-organized sections are the minimum expected experience | MEDIUM | Extend `html-report.ts` to render aspect sections with collapsed/expanded views per group |
| Per-aspect progress indicator in terminal | With 4 agents running in parallel, the user needs to know something is happening — which agents are active, which completed | LOW | Print "Security agent... done", "Performance agent... done" style progress lines as agents report back; matches existing `printProgress`/`printProgressDone` pattern |
| Agent team works in both quick and deep modes | The project spec requires this. Users who already use `--deep` should get agent teams automatically | HIGH | Two integration paths: quick mode lead agent gets diff as context; deep mode lead agent gets cloned repo path; both paths produce the same output shape |

### Differentiators (Competitive Advantage)

Features that make the multi-agent review meaningfully better than either (a) the existing single-agent tool or (b) competitor AI review tools.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Four fixed, expert-scoped aspect agents | Each agent gets a narrow, well-defined scope — security agent is not distracted by nitpick style issues, test coverage agent is not distracted by performance. Fixed scope means better depth per dimension than a generalist reviewer | LOW | Fixed four: security, performance, code quality, test coverage. Scope is defined in each agent's spawn prompt; lead prompt instructs independence |
| Lead agent produces a single merged finding list | Users receive one unified JSON array (consistent with the existing `ReviewFinding` schema), not four separate arrays requiring manual merging. The schema stays unchanged — only the grouping metadata changes | MEDIUM | Add optional `aspect` field to `ReviewFinding` schema (Zod) to tag which agent surfaced each finding; lead merges and deduplicates before emitting final JSON |
| Semantic deduplication (not just line-number matching) | Simple file+line deduplication misses rephrased duplicates. Lead agent prompt instructs semantic merging: two findings on the same issue should merge into one, crediting all agents that identified it | MEDIUM | Implemented in the lead agent's prompt instructions, not in TypeScript code. Complexity is prompt engineering, not code |
| Aspect summary header in terminal ("No performance issues found") | When an agent finds nothing, that result is meaningful — the user should see "Performance: no issues" not silence. Explicit clean signals prevent "did that agent even run?" confusion | LOW | Print aspect headers with finding count; zero-finding aspects print a dim "no findings" line rather than being omitted |
| Cost and timing reported per agent (verbose mode) | In `--verbose` mode, showing per-agent cost and duration lets users understand where time and money are spent across the team | LOW | Each agent's `AnalysisMeta` (from the existing interface) includes `cost_usd` and `duration_ms`; aggregate and per-agent totals printed under `[debug]` lines |

### Anti-Features (Commonly Requested, Often Problematic)

Features that appear useful but introduce complexity without proportional value in this context.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Configurable aspect selection (`--aspects security,performance`) | Power users want to pick which agents run | Adds CLI surface area, multiplies prompt maintenance (N aspects = N maintained prompts), creates "why did I get fewer findings than expected?" debugging. The value of fixed aspects is simplicity and consistency across reviews. PROJECT.md explicitly marks this out of scope for this milestone | Fixed four aspects. Revisit only if user feedback demonstrates a clear unmet need |
| Inter-agent debate/challenge patterns | Agents arguing and refining each other's findings sounds thorough | Dramatically increases token cost (broadcast messages cost N × tokens), extends wall-clock time, requires complex convergence detection, and can produce contradictory findings that confuse users more than a single agent's clean output. PROJECT.md marks this out of scope | Independent aspect agents with lead-side deduplication achieves the review quality improvement without the coordination cost |
| Real-time progress streaming per teammate to terminal | Seeing each agent's exploration in real-time feels transparent | In-process teammate mode streams all agents to the same terminal simultaneously — interleaved output from 4 agents is unreadable noise. Deep mode already streams stderr for the single agentic session; extending this to 4 agents creates chaos | Print progress indicators when each agent starts and completes; avoid streaming raw agent exploration output |
| Interactive pause-and-inspect of individual agents | Users want to see what each agent is doing mid-review | This is an interactive terminal feature (tmux/split panes). The tool is explicitly a non-interactive CLI; adding interactive modes violates the design contract. PROJECT.md marks this out of scope | Post-review: `--verbose` mode can show per-agent metadata and finding attribution |
| Per-file agent parallelism (one agent per changed file) | Feels more granular than per-aspect | Files in a PR are not independent — a security issue in one file may be rooted in a utility function in another. Aspect-based parallelism is semantically appropriate; file-based parallelism produces isolated, context-free findings. PROJECT.md marks this out of scope | Keep aspect-based parallelism; agentic agents can already cross file boundaries |
| Agent team auto-approve and submit review | "Just submit it" as a one-shot command | Multi-agent reviews surface more findings than single-agent reviews. A PENDING draft that the human reviews before submitting is not just a policy choice — it is the correct UX for a higher-volume output. Auto-approve is never implemented in this tool per CLAUDE.md and SECURITY.md | Always post as PENDING. Findings from agent teams are no different. |
| Custom aspect definitions via plugin system | Teams have domain-specific concerns (HIPAA compliance, internal style rules) | Plugin systems require stable extension APIs, versioning, documentation, and ongoing maintenance. The tool has a 4-dep budget and zero dependency on a plugin framework | Cover common cases well (the fixed four) and accept that domain-specific needs are out of scope for now |

---

## Feature Dependencies

```
[Parallel agent execution]
    └──requires──> [Agent teams feature flag detection]
    └──requires──> [Lead agent prompt with aspect assignments]
    └──requires──> [Per-agent JSON findings collection]
                       └──requires──> [Existing ReviewFinding schema + optional aspect field]

[Aspect-tagged findings]
    └──requires──> [Lead synthesis + deduplication]
    └──enables──> [Terminal grouped output]
    └──enables──> [GitHub review grouped comments]
    └──enables──> [HTML report grouped sections]

[Graceful degradation]
    └──requires──> [Feature flag check at startup]
    └──enables──> [Existing single-agent path unchanged]

[Both modes (quick + deep)]
    └──quick mode──requires──> [Lead agent receives diff as context]
    └──deep mode──requires──> [Lead agent receives cloned repo path]
    └──both──produce──> [Same ReviewFinding[] output shape]
```

### Dependency Notes

- **Parallel agent execution requires aspect field in ReviewFinding:** The existing Zod schema (`ReviewFindingSchema`) needs one optional field `aspect?: 'security' | 'performance' | 'quality' | 'tests'` added. This is the only schema change required. All downstream consumers (GitHub poster, HTML report, terminal output) can treat aspect as display metadata and remain backwards-compatible.

- **Grouped output requires aspect tagging:** Terminal, GitHub, and HTML output grouping all depend on the aspect field on findings. Without it, grouping is impossible. This creates a single required schema migration that unblocks all three output paths.

- **Graceful degradation requires feature flag check:** The detection of whether `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set (or the agent teams invocation attempt fails) must happen early — before analysis begins — so the fallback path is clean and the user sees a single consistent output format.

- **Lead synthesis must happen before output:** The lead agent must complete deduplication and JSON assembly before any terminal output, GitHub posting, or HTML generation occurs. This means agent team review is not incrementally streamable (unlike the current deep mode which streams stderr in real time). This is a UX tradeoff: clean, deduplicated output vs. real-time streaming. Clean output wins.

- **Per-agent cost reporting enhances but does not block:** The verbose-mode per-agent cost and duration display is an enhancement that depends on per-agent `AnalysisMeta` being captured, but its absence does not break any core feature.

---

## MVP Definition

### Launch With (v1 of this milestone)

Minimum viable agent team feature — what makes this milestone complete and useful.

- [ ] Feature flag detection: check `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` at startup; if absent or disabled, fall back to existing single-agent path with a dim notice — "Agent teams unavailable, running single-agent review"
- [ ] Lead agent prompt: a single lead agent prompt that spawns four specialized teammates (security, performance, code quality, test coverage), waits for all to report, deduplicates findings, and outputs a single flat JSON array with `aspect` tags — compatible with the existing `ReviewFinding` schema
- [ ] Add `aspect` field to `ReviewFindingSchema` in `schemas.ts` (optional enum: `'security' | 'performance' | 'quality' | 'tests'`). Backwards-compatible: existing single-agent findings have no aspect, downstream code handles null gracefully
- [ ] Terminal output grouped by aspect: extend `printFindings()` or add `printFindingsByAspect()` to `output.ts` — prints aspect headers before each group, shows "no findings" for clean agents
- [ ] Works in quick mode: lead agent receives the PR diff as context (consistent with existing `analyzeDiff()` entry point); new `analyzeTeam()` function wraps agent team invocation
- [ ] Works in deep mode: lead agent receives the cloned repo path (consistent with existing `analyzeAgentic()` entry point); `analyzeTeamAgentic()` wraps deep agent team invocation
- [ ] Graceful fallback deep-to-quick: if agent team deep mode fails (clone error), falls back to agent team quick mode, then further to single-agent quick mode — consistent with existing fallback chain

### Add After Validation (v1.x)

Features to add once the core agent team flow is running and validated.

- [ ] GitHub review comments grouped by aspect: extend `buildReviewBody()` to emit aspect section headers before off-diff finding groups — triggers when enough users use `--post` with agent teams to confirm the format is useful
- [ ] HTML report aspect sections: extend `html-report.ts` to render collapsible aspect sections — triggers when HTML report usage (--html flag) is observed in practice
- [ ] Per-agent cost/duration in verbose mode: add aggregate and per-agent cost display under `[debug]` lines — low-complexity addition once the per-agent metadata plumbing is confirmed working

### Future Consideration (v2+)

Features to defer until product-market fit for agent teams is established.

- [ ] Configurable aspect selection (`--aspects` flag): defer until user feedback shows the fixed four are systematically inadequate for a significant cohort
- [ ] Aspect-level mode overlays: applying `--mode strict` only to the security agent, not the quality agent — complex interaction surface with limited proven need
- [ ] Parallel agent teams for multiple PRs: running agent teams on a batch of PRs simultaneously — fundamentally different workflow (batch mode) not part of the tool's current design

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Parallel agent execution (4 specialized agents) | HIGH | HIGH | P1 |
| Lead agent synthesis + deduplication | HIGH | HIGH | P1 |
| Graceful degradation to single-agent | HIGH | LOW | P1 |
| `aspect` field on `ReviewFinding` schema | HIGH | LOW | P1 |
| Terminal output grouped by aspect | HIGH | LOW | P1 |
| Quick mode agent team integration | HIGH | MEDIUM | P1 |
| Deep mode agent team integration | HIGH | MEDIUM | P1 |
| GitHub review comments grouped by aspect | MEDIUM | LOW | P2 |
| HTML report aspect sections | MEDIUM | MEDIUM | P2 |
| Per-agent cost/duration in verbose mode | LOW | LOW | P2 |
| Configurable aspect selection | LOW | HIGH | P3 |
| Custom aspect definitions / plugin system | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for milestone launch
- P2: Should have, add when possible within milestone
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

The tool is a CLI, not a SaaS product. The relevant "competitors" are (a) existing AI review tools and (b) community-built parallel agent review patterns. The tool's advantage is deep integration with the existing security model, output pipelines, and the Claude Code agent teams API specifically.

| Feature | CodeRabbit (SaaS) | Community parallel-subagent patterns (e.g., hamy.xyz/playbooks) | This tool |
|---------|------|------|------|
| Specialized per-aspect agents | Single model, multi-category findings | 4-9 specialized subagents | 4 fixed aspect agents via agent teams API |
| Finding deduplication | Vendor-side, opaque | Lead agent prompt-driven | Lead agent prompt-driven, schema-enforced |
| Findings grouped by aspect in terminal | Not applicable (web UI) | Text sections in stdout | Aspect headers in existing picocolors output |
| GitHub inline comment routing | Full integration | Post-processing required | Existing routing (inline vs off-diff) reused |
| Graceful degradation | Not applicable (always available) | Not present in most patterns | Explicit fallback chain to single-agent |
| Security model (credential scrubbing, env filter) | Vendor-managed | Not present | Existing `scrubSecrets()` + `filterEnv()` applied to all agent output |
| Dependency budget | Not applicable | Not applicable | 4-dep hard limit; no new deps for agent coordination |

---

## Key Technical Observations

These are findings that directly constrain feature design, verified against official documentation.

**Agent teams run non-interactively via a single lead prompt.** The official Claude Code agent teams docs confirm a single natural-language prompt drives the entire workflow without further user interaction. The lead creates tasks, spawns teammates, monitors completion, and synthesizes. This means the existing `spawn`/`execFile` subprocess model can drive agent teams through a single lead prompt — no new interaction model needed.

**Agent teams increase token cost significantly.** The official docs state: "Agent teams use significantly more tokens than a single session. Each teammate has its own context window, and token usage scales with the number of active teammates." Four teammates means roughly 4× token cost vs. single-agent for the same analysis. This is an accepted tradeoff (the project's core value is thoroughness), but it informs: (a) verbose mode should show per-agent cost, and (b) the tool should not silently increase user costs without a visible signal.

**Task status lag is a known limitation.** The official docs list "task status can lag: teammates sometimes fail to mark tasks as completed." This means the lead agent's synthesis step may need defensive handling — do not rely on task-completion signals alone as a gate for synthesis; use messaging (teammates report via `SendMessage`) as the primary completion indicator.

**In-process mode (not tmux) is the correct display mode for this CLI.** The tool is non-interactive (`--print` / non-TTY safe). The agent teams `teammateMode` defaults to `"auto"`, which uses in-process in non-tmux environments. This is correct for this tool. Do not attempt to configure split-pane mode — it requires tmux or iTerm2 and is incompatible with automated/CI use.

**Broadcast is expensive; prefer direct messaging.** The gist pattern analysis confirms: "Broadcasting is expensive — sends N separate messages for N teammates." The lead agent prompt should instruct teammates to write directly to the lead's inbox (`TeammateTool.write` to lead), not broadcast to each other.

---

## Sources

- [Official Claude Code Agent Teams Docs](https://code.claude.com/docs/en/agent-teams) — HIGH confidence, authoritative
- [AddyOsmani: Claude Code Swarms](https://addyosmani.com/blog/claude-code-agent-teams/) — MEDIUM confidence, community analysis
- [Parallel Code Review Skill (playbooks.com)](https://playbooks.com/skills/dgalarza/claude-code-workflows/parallel-code-review) — MEDIUM confidence, community pattern
- [hamy.xyz: 9 Parallel Agents Code Review](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents) — MEDIUM confidence, community pattern
- [Swarm Orchestration Gist (kieranklaassen)](https://gist.github.com/kieranklaassen/4f2aba89594a4aea4ad64d753984b2ea) — MEDIUM confidence, community pattern
- [alexop.dev: From Tasks to Swarms](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/) — MEDIUM confidence, community analysis
- [State of AI Code Review Tools 2025 (devtoolsacademy)](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/) — MEDIUM confidence, market analysis
- [tessl.io: Best Agent Skills for Code Review](https://tessl.io/blog/best-agent-skills-for-ai-code-review-8-evaluated-skills-for-dev-workflows/) — LOW-MEDIUM confidence, product review

---

*Feature research for: parallel multi-agent code review (codereview CLI agent teams milestone)*
*Researched: 2026-03-05*

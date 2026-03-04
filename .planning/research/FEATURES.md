# Feature Research

**Domain:** AI-powered pull request code review quality
**Researched:** 2026-03-04
**Confidence:** HIGH (competitive tools verified via official docs and published benchmarks; patterns corroborated across multiple independent sources)

---

## Context: What "Quality" Means Here

This project already ships end-to-end. Quick mode and deep (agentic) mode work. The milestone is about review *judgment quality* — the gap between findings that feel generic (could apply to any codebase) and findings that feel like a senior engineer who knows the project wrote them.

The research question: what techniques distinguish tools like CodeRabbit and Greptile (which teams rate as high-quality) from basic LLM diff prompting?

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that make a review feel legitimate. Missing these makes output feel like a toy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Severity tiers (bug/security/suggestion/nitpick) | All mature tools do this; without it, critical findings are indistinguishable from nits | LOW | **Already built** — `severity` field in schema. Gap: calibration instructions in prompt need sharpening. |
| Confidence scoring per finding | Users need to know which findings to trust; "medium" confidence flags are for attention, "low" are informational | LOW | **Already built** — `confidence` field in schema. Gap: the schema has it but prompt instructions need to make the LLM use it meaningfully. |
| PR intent awareness | Reviewer must understand what the PR is trying to do before judging how well it does it | LOW | **Partially built** — PR title/description already passed to Claude. Gap: prompt doesn't explicitly instruct Claude to derive intent and calibrate findings against it. |
| Changed-file context (adjacent files) | Reviewers need to see callers, tests, interfaces for changed files — not just the diff lines | MEDIUM | **Gap** — quick mode sends only the diff. Deep mode lets Claude explore freely but without explicit guidance on which adjacent files matter most. |
| Suppression of pure style/formatting noise | Sending 40 indentation nits buries real bugs; developers stop reading | LOW | **Partially built** — `balanced` mode overlay tries to suppress this. Gap: the filter logic is in free-text instructions, not enforced structurally. |
| Actionable descriptions ("X is wrong, here's why, here's how to fix it") | Vague findings waste engineer time; quality review explains root cause and fix | LOW | **Already built** — `description` field requires 2-4 sentences with fix guidance. Holding the line here is table stakes. |
| Cross-file issue detection for deep mode | Pattern violations, broken callers, and duplication are invisible from the diff | HIGH | **Already built** in deep mode via agentic exploration. Gap: no structured guidance on *which* cross-file categories to prioritize. |

### Differentiators (Competitive Advantage)

Features that make the tool feel like a senior engineer who *knows this specific codebase*, not a generic AI.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Pre-review codebase convention scan | Before judging a change, read 2-3 representative files to understand naming patterns, error handling style, module structure — then calibrate findings against *this* codebase, not generic best practices | MEDIUM | Deep mode already clones repo. Gap: no explicit instruction to do a convention scan *before* reviewing. Implement as a structured Phase 0 in the agentic prompt. |
| PR-aware context gathering (smart file selection) | For quick mode: fetch the 3-5 files most likely to contain the callers, interfaces, or tests for the changed code — expand context without full clone | HIGH | Currently quick mode gets diff only. Would require fetching additional files via GitHub API (`/contents` endpoint). No new dependencies needed (Octokit already available). Complexity is in the selection heuristic (imports, filenames, test paths). |
| Intent-calibrated severity | Explicitly derive what the PR is trying to accomplish, then judge each finding against that goal. A "missing error handler" in a proof-of-concept is different from a "missing error handler" in a payment path | MEDIUM | PR metadata already in prompt. Gap: no explicit instruction to reason about PR scope and intent before assigning severities. Pure prompt improvement — no schema or architecture change needed. |
| Low-confidence finding suppression | Filter out findings where Claude itself signals uncertainty — don't surface "low" confidence findings as inline comments; batch them separately or discard | LOW | `confidence` field already exists. Gap: the output layer (`output.ts`, `review-builder.ts`) doesn't yet filter by confidence. A threshold option (e.g., `--min-confidence medium`) would let users tune the signal-to-noise ratio. |
| Evidence-grounded cross-file findings | Every cross-file finding must cite specific file paths and line numbers as evidence — not "this pattern might be inconsistent" but "this conflicts with the pattern in `src/auth.ts:42`" | LOW | **Partially built** — `relatedLocations` field exists in schema. Gap: prompt instructs Claude to include `relatedLocations` only for cross-file findings; could strengthen the instruction to require evidence for *all* findings above bug severity. |
| Finding deduplication | Deep mode can discover the same issue from both diff analysis and cross-file exploration — deduplicate before output | LOW | No deduplication exists today. Post-processing step in `analyzer.ts` or a new `dedup.ts` module. Heuristic: same file + overlapping line range + similar category = duplicate. |
| Structured convention detection output | Have Claude emit detected conventions as structured metadata alongside findings — reusable across repeated runs on the same repo | HIGH | Would require schema change (new `conventions` field), prompt change, and output layer change. Significant complexity. Value is highest for teams reviewing the same repo repeatedly. Defer until core quality improvements are shipped. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that sound like quality improvements but create more problems than they solve.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-fix generation for all findings | Developers want one-click remediation | Generates churn for findings the engineer wouldn't have accepted; teaches developers to stop thinking critically; `suggestedFix` is already provided for simple cases and that's the right ceiling | Keep `suggestedFix` for simple null checks and missing imports. Never generate full-function rewrites. |
| Repo-wide semantic indexing / vector embeddings | CodeRabbit and Greptile do this for codebase-aware context | Requires persistent storage, background indexing, embedding infrastructure — entirely incompatible with a CLI tool that runs once per invocation. The deep mode clone achieves the same goal for the invocation window at zero infrastructure cost | Lean into deep mode: guide Claude to build its own understanding by reading the right files, which it can do agentic-ally without prebuilt indexes. |
| Learning from feedback / dismissal memory | Sourcery and CodeRabbit learn from developer reactions | Requires persistent state (database or config file), identity model (who is dismissing?), and ongoing maintenance. Adds significant complexity for marginal benefit in a CLI context | Expose the mode overlays (`strict`, `lenient`, `balanced`) as the mechanism for tuning. Document which mode to use for what context. |
| Specialized sub-agents (security agent, performance agent) | Qodo-style multi-agent approach for each domain | Each agent invocation costs time and money; coordination between agents introduces orchestration complexity; a single well-prompted Claude with full codebase context outperforms a poorly-coordinated multi-agent system for PR-scale analysis | Use focused prompt sections (security checklist, performance heuristics) within the single agentic session instead. |
| PR summary generation | Useful for large PRs where the title is vague | Moves the tool toward a PR assistant rather than a reviewer; adds output format complexity; Claude already reads the PR title/description before reviewing | If the description is empty, prompt Claude to briefly state what the PR appears to do as part of its review context-gathering step — keep it internal, not published output. |
| Blocking merge gates / required status checks | Feels like "enforcing quality" | Crosses from advisory to blocking; high false positive rate becomes a pipeline brake; undermines developer trust in the tool | Keep the tool advisory. PENDING reviews are visible but non-blocking. Let teams decide whether to incorporate findings. |
| Request-changes or auto-approve verdicts | "Make the AI give a thumbs up or down" | Anthropic's own guidance, the tool's existing design, and industry consensus all say AI code review should be advisory. Auto-verdicts reduce human accountability and create liability. | PENDING review status is the correct ceiling. Never implement approve or request-changes. |

---

## Feature Dependencies

```
[Intent-calibrated severity]
    └──requires──> [PR intent extraction] (already in prompt metadata)
    └──enhances──> [Severity tiers] (already built)

[Low-confidence finding suppression]
    └──requires──> [Confidence scoring] (already built in schema)
    └──requires──> [Output layer filter] (new: threshold in output.ts)

[Pre-review convention scan]
    └──requires──> [Deep mode clone] (already built)
    └──enhances──> [Cross-file issue detection] (already built)
    └──enhances──> [Pattern violation detection] (already in agentic prompt)

[PR-aware context gathering for quick mode]
    └──requires──> [Octokit /contents API access] (Octokit already available)
    └──enhances──> [Intent-calibrated severity]
    └──conflicts──> [Minimal dependency budget] (no new deps, but adds API calls)

[Finding deduplication]
    └──requires──> [Deep mode output] (findings array)
    └──standalone──> can be added as post-processing step

[Evidence-grounded cross-file findings]
    └──requires──> [relatedLocations in schema] (already built)
    └──enhances──> [Cross-file issue detection]
```

### Dependency Notes

- **Intent-calibrated severity requires PR metadata in prompt:** Already satisfied — `prData.title` and `prData.body` are in both quick and agentic prompts. The gap is in how explicitly Claude is instructed to use them for calibration.
- **Pre-review convention scan requires deep mode:** This feature only makes sense when Claude has file access. Quick mode cannot do a convention scan without fetching additional files via the GitHub API.
- **Low-confidence finding suppression requires output layer change:** The `confidence` field exists in the schema and is populated by Claude. The filter needs to be applied in `output.ts` and `review-builder.ts` before findings are rendered.
- **PR-aware context gathering for quick mode conflicts with diff-only simplicity:** Fetching related files makes quick mode slower and costs more API calls. The tradeoff is meaningful context vs. the "fast" user expectation of quick mode. This is why quick mode prompt improvement (better instructions, not more data) should come before adding file fetching.

---

## MVP Definition

This is an improvement milestone, not a new product. "MVP" here means the minimum set of changes that measurably shifts review quality.

### Ship First (this milestone)

These are pure prompt and output improvements — no schema changes, no new API calls, no architectural changes.

- [ ] **Intent-calibrated severity** — Add explicit instruction to both quick and agentic prompts: derive the PR's goal from title/description, then calibrate findings against that goal. A nit in a cleanup PR is different from a nit in a security hardening PR.
- [ ] **Pre-review convention scan (deep mode)** — Add a structured Phase 0 instruction in `buildAgenticPrompt()`: before reviewing the diff, read 2-3 representative source files (prioritizing files that are neighbors to the changed files) and identify naming conventions, error handling patterns, and structural patterns. Use these to calibrate what counts as a "pattern violation."
- [ ] **Low-confidence finding suppression** — Add `--min-confidence` flag (values: `high`, `medium`, `low`; default: `low` to preserve existing behavior). Filter findings below the threshold in `output.ts` and `review-builder.ts` before any rendering. This lets users suppress noise without changing the underlying analysis.
- [ ] **Sharpen the balanced mode overlay** — The current `balanced` overlay is good but underspecified about what "meaningful" means. Add concrete anti-examples (e.g., "Do not flag: trailing newlines, missing JSDoc on private methods, unused variable warnings that TypeScript already catches"). This is the highest-leverage low-cost change.
- [ ] **Finding deduplication** — Post-process the findings array in `analyzeAgentic()` to merge findings at the same file+line with the same category. Keep the highest-severity version.

### Add After Validating Core Quality

These require architectural work but deliver real quality gains once the foundation is solid.

- [ ] **PR-aware context gathering for quick mode** — Fetch callers and test files for changed modules via Octokit `/contents` API. Requires implementing a file selection heuristic (import graph approximation from the diff). Add after validating that prompt improvements alone don't close the quality gap.
- [ ] **Evidence requirement for high-severity findings** — Strengthen the prompt to require that `bug` and `security` severity findings include `relatedLocations` pointing to evidence (the specific lines that demonstrate the problem). Reduces false positives for the findings that matter most.

### Defer

- [ ] **Structured convention detection output** — High implementation complexity (schema changes, new output fields, storage implications). Revisit after the simpler convention scan (Phase 0 in agentic prompt) is validated to improve quality.
- [ ] **Multi-agent specialized review** — Requires orchestration infrastructure incompatible with the CLI design. If this is ever revisited, implement as separate prompt sections within the single Claude session, not separate subprocess invocations.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Sharpen balanced mode overlay | HIGH | LOW | P1 |
| Intent-calibrated severity (prompt) | HIGH | LOW | P1 |
| Pre-review convention scan (agentic prompt) | HIGH | LOW | P1 |
| Low-confidence finding suppression | HIGH | LOW | P1 |
| Finding deduplication | MEDIUM | LOW | P1 |
| PR-aware context gathering for quick mode | HIGH | MEDIUM | P2 |
| Evidence requirement for high-severity findings | MEDIUM | LOW | P2 |
| Structured convention detection output | MEDIUM | HIGH | P3 |
| Multi-agent specialized review | LOW | HIGH | P3 |

**Priority key:**
- P1: Direct prompt and output improvements — no dependencies, high signal-to-noise impact
- P2: Architectural additions that require new API calls or schema changes
- P3: Infrastructure-heavy features; defer until P1 and P2 are validated

---

## Competitor Feature Analysis

| Feature | CodeRabbit | Greptile | Sourcery | Our Approach |
|---------|------------|----------|----------|--------------|
| Codebase context | Full repo indexing with LanceDB vector search, dependency graphs | Full repo indexing, graph-based dependency analysis, multi-hop investigation | Diff + changed files only (stated limitation: misses cross-component bugs) | Deep mode: agentic Claude explores repo freely. Gap: no structured scan phase before review. |
| False positive reduction | Verification scripts, linter integration, post-generation filtering | Grounded in full repo index for repeatability; shows evidence per finding | Learning from dismissals over time | Confidence field + mode overlays. Gap: confidence threshold not enforced at output layer. |
| Intent understanding | PR/issue indexing from Jira, Linear, GitHub Issues | Analyzes related files/APIs/docs/history to understand intent | PR description only | PR title/description in prompt. Gap: not explicitly instructed to calibrate severity against intent. |
| Severity triage | Blocking/recommended/advisory tiers | Impact-ranked findings | Standard severity tiers | bug/security/suggestion/nitpick. Solid. |
| Learning / customization | Team-specific rule sets, remembers corrections | Tracks 👍/👎 reactions, uploads custom rule sets | Adapts from developer feedback | Mode overlays (`strict`/`lenient`/`balanced`/`detailed`). Simpler but effective for CLI. |
| Bug detection benchmark | 46% catch rate (devtoolsacademy 2025) | 82% catch rate (their own benchmark) | Not published | Not benchmarked — eval infrastructure exists but no baseline numbers yet. |

**Key insight from competitor analysis:** Greptile's 82% catch rate vs CodeRabbit's 46% comes primarily from its full-repo indexing and multi-hop investigation approach. For a CLI tool, the deep mode already provides equivalent access — the gap is in how well Claude is *guided* to use that access. This means prompt engineering for the agentic phase is the highest-leverage improvement available without infrastructure changes.

---

## Sources

- [CodeRabbit: How CodeRabbit delivers accurate AI code reviews on massive codebases](https://www.coderabbit.ai/blog/how-coderabbit-delivers-accurate-ai-code-reviews-on-massive-codebases) — HIGH confidence (official blog)
- [CodeRabbit: Context Engineering for AI Code Reviews](https://www.coderabbit.ai/blog/context-engineering-ai-code-reviews) — HIGH confidence (official blog)
- [Greptile: AI Code Reviews — The Ultimate Guide](https://www.greptile.com/what-is-ai-code-review) — HIGH confidence (official docs)
- [Greptile: Graph-Based Codebase Context](https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context) — HIGH confidence (official docs)
- [AI Code Review Benchmarks 2025 — Greptile](https://www.greptile.com/benchmarks) — MEDIUM confidence (vendor benchmark, methodology not fully published)
- [State of AI Code Review Tools in 2025 — devtoolsacademy](https://www.devtoolsacademy.com/blog/state-of-ai-code-review-tools-2025/) — MEDIUM confidence (independent analysis)
- [Graphite: How Much Context Do AI Code Reviews Need?](https://graphite.com/guides/ai-code-review-context-full-repo-vs-diff) — HIGH confidence (published guide with tradeoff analysis)
- [Graphite: Effective Prompt Engineering for AI Code Reviews](https://graphite.com/guides/effective-prompt-engineering-ai-code-reviews) — MEDIUM confidence (practitioner guide)
- [Qodo: 5 AI Code Review Pattern Predictions in 2026](https://www.qodo.ai/blog/5-ai-code-review-pattern-predictions-in-2026/) — MEDIUM confidence (vendor analysis)
- [Qodo: 8 Best AI Code Review Tools That Catch Real Bugs in 2026](https://www.qodo.ai/blog/best-ai-code-review-tools-2026/) — MEDIUM confidence (vendor roundup)
- [Addy Osmani: Code Review in the Age of AI](https://addyo.substack.com/p/code-review-in-the-age-of-ai) — HIGH confidence (authoritative practitioner analysis)
- [How Many False Positives Are Too Many in AI Code Review — CodeAnt](https://www.codeant.ai/blogs/ai-code-review-false-positives) — MEDIUM confidence (industry analysis)
- [CodeRabbit: 5 Code Review Anti-Patterns You Can Eliminate with AI](https://www.coderabbit.ai/blog/5-code-review-anti-patterns-you-can-eliminate-with-ai) — MEDIUM confidence (vendor perspective)
- [DEV Community: How AI Explains Code Correctly but Misses Architectural Context](https://dev.to/rohit_gavali_0c2ad84fe4e0/how-ai-explains-code-correctly-but-misses-architectural-context-1an8) — MEDIUM confidence (practitioner observation)

---

*Feature research for: AI-powered PR code review quality improvement*
*Researched: 2026-03-04*

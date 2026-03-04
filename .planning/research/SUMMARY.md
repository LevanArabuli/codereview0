# Project Research Summary

**Project:** codereview0 — AI-powered PR code review quality improvement milestone
**Domain:** AI-powered CLI code review (prompt engineering, context-gathering, structured output)
**Researched:** 2026-03-04
**Confidence:** HIGH

## Executive Summary

This project already ships an end-to-end working tool. Quick mode and deep (agentic) mode both function. The milestone is narrowly defined: improve *review judgment quality* — the difference between findings that feel generic and findings that feel like a senior engineer who knows this specific codebase wrote them. Research confirms this goal is achievable through prompt engineering, structured context injection, and post-analysis filtering — all within the existing 4-dependency budget (commander, @octokit/rest, zod, picocolors), with no new runtime dependencies required.

The recommended approach is a five-phase build that proceeds from foundation to surface: establish filtering infrastructure first (pure functions, easy to test), then add context-gathering infrastructure, then wire context into prompts, then wire everything through the CLI orchestrator, and finally iterate on prompt calibration as the last step once the pipeline is stable. Two new modules (`context-gatherer.ts`, `finding-filter.ts`) and one new type (`ReviewContext`) cover the architectural additions needed. All other modules remain API-compatible.

The primary risk is a class of well-documented LLM failure modes that counterintuitively make quality worse: detailed prompts increase false rejection rates, confidence scores do not accurately reflect accuracy, excessive context displaces diff attention, and intent-awareness can cause the model to review against PR-author goals rather than independent quality standards. Every improvement technique has a corresponding pitfall. The mitigation strategy throughout is eval-first: no prompt change ships without running the existing fixture-based eval infrastructure, and every new suppression criterion must be accompanied by a counter-example fixture that it should not suppress.

---

## Key Findings

### Recommended Stack

The entire quality improvement scope is achievable without adding a single runtime dependency. The existing Zod schema already has `confidence`, `severity`, and `category` fields. The `@octokit/rest` package already provides `repos.getContent()` for fetching related file context in quick mode. Node.js built-in `fs` APIs cover all filesystem reads needed for deep mode convention detection. The Claude CLI subprocess interface (`claude -p`) is the only AI integration path — the native Anthropic SDK structured outputs feature (`output_config.format`) is not accessible through the CLI and must not be used as a justification for adding `@anthropic-ai/sdk` as a runtime dependency.

The real "stack change" is prompt engineering patterns: two-phase XML structure separating `<thinking>` reasoning from JSON output, convention detection phase instructions in the agentic prompt, intent-first PR analysis framing, confidence calibration guidance, and few-shot severity examples. These are pure string-template changes in `src/prompt.ts`.

**Core technologies (no changes):**
- TypeScript 5.9.x — strict mode, ES2022, NodeNext modules
- Node.js >=22 — built-in `fs`, `path`, `child_process` cover all context-gathering needs
- Zod 4.3.x — `ReviewFindingSchema` already validates `confidence`, `severity`, `category`; additive `.optional()` fields are the only schema changes needed
- `@octokit/rest` 22.x — `repos.getContent()` unlocks quick-mode related-file context with no new dependencies

**What not to use:**
- `@anthropic-ai/sdk` — exceeds dependency budget, breaks existing auth model, not justified
- `langchain`, `llamaindex`, or any prompt framework — overkill for string construction
- `typescript` as a runtime dep for AST analysis — Claude's agentic file access is equivalent and dependency-free
- Prefilled assistant responses — deprecated in Claude 4.6 models

### Expected Features

Research against CodeRabbit, Greptile, Sourcery, and Qodo confirms that the quality gap between the current tool and top-tier tools is not architectural — it is guidance quality. Greptile's 82% bug catch rate vs. CodeRabbit's 46% comes from full-repo indexing. The deep mode clone provides equivalent access. The gap is in how well Claude is guided to use that access.

**Must have (table stakes — mostly already built, gaps noted):**
- Severity tiers (bug/security/suggestion/nitpick) — built; gap is calibration instructions
- Confidence scoring per finding — built in schema; gap is prompt instructions making it meaningful
- PR intent awareness — partially built; gap is explicit calibration instruction against intent
- Suppression of pure style/formatting noise — partially built; gap is structural enforcement
- Actionable descriptions with fix guidance — built; maintain the standard

**Should have (competitive differentiators for this milestone):**
- Pre-review codebase convention scan (deep mode Phase 0) — highest-leverage prompt improvement
- Intent-calibrated severity — PR metadata already passed in; needs explicit reasoning instruction
- Low-confidence finding suppression via `--min-confidence` flag — `confidence` field exists, output layer filter needed
- Finding deduplication — post-processing in `analyzeAgentic()`, same file+line+category merge
- Sharpen balanced mode overlay with concrete anti-examples

**Defer to v2+:**
- PR-aware related-file fetching for quick mode — adds API calls and selection heuristic complexity; validate prompt improvements close the gap first
- Structured convention detection output as persistent metadata — schema changes, storage implications, high complexity
- Multi-agent specialized review (security agent, performance agent) — orchestration incompatible with CLI design

**Anti-features (do not implement):**
- Auto-fix generation beyond `suggestedFix` for simple cases
- Repo-wide vector embeddings / semantic indexing
- Learning from feedback / dismissal memory
- Request-changes or auto-approve verdicts — advisory tool only, PENDING reviews only

### Architecture Approach

The quality improvements add two new layers to the existing flat sequential pipeline without breaking the existing API contracts. A **context layer** (`context-gatherer.ts`) sits between data fetching and prompt construction; a **filter layer** (`finding-filter.ts`) sits between Claude's output and the display/post layer. Both modes (quick and deep) flow through these layers with the same data types. The central integration contract — `ReviewFinding[]` — is unchanged.

**Major components:**
1. `context-gatherer.ts` (NEW) — builds `ReviewContext` from `PRData` and optional `clonePath`; quick mode derives intent from PR metadata, deep mode reads filesystem for convention patterns; operates under explicit budget caps (20 files max, 500 lines each, 8 conventions max)
2. `finding-filter.ts` (NEW) — pure function over `ReviewFinding[]`; applies confidence/severity threshold rules deterministically; never suppresses `bug` or `security` severity regardless of confidence
3. `prompt.ts` (MODIFIED) — `buildPrompt()` and `buildAgenticPrompt()` gain optional `ReviewContext` parameter; backward compatible; injects `<pr_intent>`, `<codebase_conventions>`, and (deep mode) `<related_files>` XML sections
4. `types.ts` (MODIFIED) — adds `ReviewContext` interface (intent, conventions, relatedFiles, depth)
5. `cli.ts` (MODIFIED) — calls `gatherContext()` before prompt construction, calls `filterFindings()` after analysis

**Modules that do not change:** `analyzer.ts`, `schemas.ts`, `github.ts`, `output.ts`, `html-report.ts`, `formatter.ts`, `diff-parser.ts`, `review-builder.ts`, `cloner.ts`, `prerequisites.ts`.

### Critical Pitfalls

1. **Detailed prompts cause over-rejection** — Adding required rationale fields or required fix examples causes LLMs to invent reasons for rejection (48% of false positives in published research). Keep output fields minimal. Test every prompt change against eval fixtures before shipping. New fields must be `.optional()` in the schema.

2. **Confidence scores reflect verbosity, not accuracy** — LLMs do not have internally coherent uncertainty. "High confidence" is generated when the finding sounds assertive, not when it is accurate. Treat confidence as a sort signal, not a filter, until calibration against the eval corpus validates that low-confidence findings have a measurably higher false positive rate.

3. **Context overload degrades diff focus** — Too much injected context (convention files, READMEs, config dumps) displaces attention from the diff itself. Cap context at 8KB total additions. Place context immediately before review instructions, not buried in a preamble. Convention context must be summarized rules, never raw file excerpts.

4. **Intent-awareness anchors to PR-author framing** — Using PR intent as review criteria causes the model to confirm the PR achieves its stated goal rather than independently judge code quality. Frame intent under "PR Context" (background), not "Review Criteria." Explicitly instruct: review against independent quality standards, not against stated intent.

5. **Convention detection from PR branch is a security issue** — Convention reading must scope to base-branch files only. PR-author-modified files are untrusted and could plant misleading "conventions" that manipulate the review. Exclude `.env*`, `*.key`, `*.pem`, and credential config files from convention detection.

---

## Implications for Roadmap

The architecture research provides a dependency-aware build order that maps cleanly to roadmap phases. The ordering is non-negotiable: each phase produces stable, tested output that the next phase depends on.

### Phase 1: Filter Foundation

**Rationale:** `finding-filter.ts` is a pure function with zero dependencies — safest to build and test in isolation. Establishes the filtering contract that later phases depend on. Getting this right before adding context means the output layer is ready when context produces more findings to filter.

**Delivers:** `filterFindings(findings, mode)` pure function; tests covering all filtering rules; confidence threshold logic validated against existing eval corpus.

**Addresses:** Low-confidence finding suppression (FEATURES P1), finding deduplication (FEATURES P1).

**Avoids:** Suppression creates blind spots (PITFALL 6) — counter-example fixtures must be written alongside every suppression rule.

**Research flag:** Standard patterns, no additional research needed. Pure function over typed data.

### Phase 2: Context Infrastructure

**Rationale:** `ReviewContext` type and `context-gatherer.ts` must exist before `prompt.ts` can reference them. Deep mode context gathering requires careful scoping to base-branch files (security constraint). Budget caps must be established here to prevent later performance traps.

**Delivers:** `ReviewContext` type in `types.ts`; `gatherContext(prData, clonePath?)` function; tests for both shallow (quick mode) and deep paths; budget cap constants (`CONTEXT_LIMITS`).

**Addresses:** Pre-review convention scan (FEATURES P1), PR-aware context for deep mode.

**Avoids:** Convention context from PR branch (PITFALL — security), pattern samples too small (PITFALL 4), context overload (PITFALL 3). Budget caps are mandatory here.

**Research flag:** Needs careful implementation review. Convention detection scoping to base-branch files is a security invariant. The `CONTEXT_LIMITS` constants need review against real repo sizes before shipping.

### Phase 3: Prompt Layer Integration

**Rationale:** `ReviewContext` type must exist (Phase 2) before `prompt.ts` can accept it as a parameter. Prompt changes are backward compatible (optional parameter) so existing behavior is preserved. This phase also covers the chain-of-thought XML structure and calibration instructions that do not require context.

**Delivers:** Modified `buildPrompt()` and `buildAgenticPrompt()` accepting optional `ReviewContext`; XML section injection (`<pr_intent>`, `<codebase_conventions>`, `<related_files>`); `<thinking>` chain-of-thought instruction; confidence calibration guidance; few-shot severity examples in `FINDING_FORMAT_INSTRUCTIONS`.

**Addresses:** Intent-calibrated severity (FEATURES P1), pre-review convention scan integration, two-phase XML structure (STACK), confidence calibration (STACK), severity examples (STACK).

**Avoids:** Intent-awareness adds subjectivity (PITFALL 7) — intent must be framed as background context, not review criteria.

**Research flag:** Standard prompt engineering patterns from Anthropic official docs. Confidence calibration guidance is MEDIUM confidence from a single academic source (ACM TOSEM 2025).

### Phase 4: CLI Wiring

**Rationale:** Prompts must accept context (Phase 3) and filter must exist (Phase 1) before `cli.ts` can call them. Wiring must be stable before iterating on prompt calibration — conflating wiring bugs with quality issues is a common trap.

**Delivers:** Modified `cli.ts` calling `gatherContext()` before prompt construction and `filterFindings()` after analysis; `--min-confidence` flag; integration tests through the eval fixture infrastructure.

**Addresses:** Full pipeline integration, `--min-confidence` flag surfacing confidence suppression to users.

**Avoids:** Agentic turn budget consumed by convention detection (PITFALL — integration gotcha). Check that `MAX_AGENTIC_TURNS = 75` is sufficient after adding convention detection phase. Add total prompt size guard since the diff truncation guard only applies to the diff, not the total prompt.

**Research flag:** Standard wiring, but the agentic turn budget and total prompt size guard are specific to this codebase and need validation against real PRs. Recommended to run eval fixtures on at least 3 representative PRs.

### Phase 5: Prompt Calibration

**Rationale:** Prompt calibration is iterative and subjective. Building it last means it runs on a stable, wired pipeline where quality shifts are attributable to prompt changes, not infrastructure bugs. This is the phase most likely to need multiple iterations.

**Delivers:** Sharpened `balanced` mode overlay with concrete anti-examples; refined severity calibration instructions; validated `FINDING_FORMAT_INSTRUCTIONS`; eval corpus expanded to cover new behaviors.

**Addresses:** Sharpen balanced mode overlay (FEATURES P1), severity calibration (FEATURES table stakes gap), noise suppression improvement.

**Avoids:** Tuning prompts by feel (PITFALL — technical debt), severity inflation (PITFALL 5), detailed prompts cause over-rejection (PITFALL 1). Every change must run through eval fixtures. Prompt changes need version tagging to enable rollback.

**Research flag:** This phase benefits most from `/gsd:research-phase`. The severity calibration thresholds and balanced mode anti-examples need validation against real PR samples that don't exist in the current fixture corpus. Academic source (ACM TOSEM 2025 structured CoT) is MEDIUM confidence from a single paper.

### Phase Ordering Rationale

- **Filter before context:** The filter is dependency-free; building it first creates a tested safety net before the pipeline gets more complex.
- **Context before prompt:** TypeScript strictness requires `ReviewContext` type to exist before `prompt.ts` references it.
- **Prompt before wiring:** CLI wiring calls `buildPrompt()` with context — the signature must be stable first.
- **Wiring before calibration:** Calibration changes must be attributable to prompts, not integration bugs.
- **Calibration last and iterative:** Quality judgment is subjective and improves through feedback. This is the only phase that should be revisited multiple times.

### Research Flags

Phases needing deeper research during planning:
- **Phase 2 (Context Infrastructure):** Convention detection scoping to base-branch is a security invariant with no existing implementation pattern in the codebase. Needs specific review.
- **Phase 5 (Prompt Calibration):** Severity calibration thresholds and anti-example selection need validation against real PRs. Current eval corpus may not cover the calibration scenarios adequately. Recommend `/gsd:research-phase` here.

Phases with standard patterns (skip additional research):
- **Phase 1 (Filter Foundation):** Pure function over typed data. Trivially testable. Standard patterns.
- **Phase 3 (Prompt Layer Integration):** Anthropic official docs provide clear guidance on XML tags, chain-of-thought, and few-shot examples. Backward-compatible optional parameter is a standard TypeScript pattern.
- **Phase 4 (CLI Wiring):** Standard orchestration wiring. The specific gotchas (turn budget, total prompt size guard) are identified and documented.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against Anthropic official docs, existing codebase, confirmed no new dependencies required. The one gap (CLI vs. SDK structured outputs) is documented clearly. |
| Features | HIGH | Competitor features verified via official docs (CodeRabbit, Greptile, Sourcery, Qodo). Prioritization is well-grounded. The 82% vs. 46% benchmark numbers are MEDIUM confidence (vendor-published). |
| Architecture | HIGH | Derived from codebase analysis + architecture principles. All module interactions are verifiable against existing code. New modules are simple. |
| Pitfalls | HIGH | Primary pitfall (over-rejection from detailed prompts) sourced from recent peer-reviewed research (arXiv 2603.00539, 2026). Confidence miscalibration from OpenReview and arXiv 2508.06225. Security pitfalls derived from codebase architecture analysis. |

**Overall confidence:** HIGH

### Gaps to Address

- **Confidence suppression calibration:** The research confirms confidence scores are unreliable, but does not tell us what fraction of current low-confidence findings in this specific tool are true vs. false positives. Before enabling `--min-confidence` filtering by default, measure false positive rates on the existing eval corpus.

- **Agentic turn budget validation:** `MAX_AGENTIC_TURNS = 75` was set before convention detection was planned. Adding a Phase 0 convention scan consumes turns before review starts. Need to measure typical turn consumption of convention detection against the existing budget.

- **Total prompt size guard:** The 80KB truncation guard applies to the diff only. After adding context injection, the total prompt (base instructions + context + diff) needs its own size guard. Current maximum is unvalidated.

- **Eval corpus coverage for calibration:** The existing eval fixture corpus covers correct behavior. It may not have sufficient coverage of severity distribution across PR types (cleanup PR vs. security hardening PR vs. feature PR) to validate Phase 5 calibration changes.

---

## Sources

### Primary (HIGH confidence)
- Anthropic prompt engineering official docs — XML tags, chain-of-thought, few-shot examples, output formatting
- Anthropic structured outputs docs — confirmed `output_config.format` is API-only, not CLI-accessible
- CodeRabbit official blog — context engineering, pipeline vs. agentic AI for code reviews
- Greptile official docs — graph-based codebase context, how Greptile works
- arXiv 2603.00539 (2026) — LLM over-rejection, false negative root cause taxonomy, 5-LLM study
- Codebase analysis (first-party) — `src/prompt.ts`, `src/analyzer.ts`, `src/schemas.ts`, `src/types.ts`

### Secondary (MEDIUM confidence)
- Structured Chain-of-Thought for Code, ACM TOSEM 2025 — 13.79% improvement claim; single academic source
- arXiv 2508.06225 — confidence score miscalibration in LLM-as-judge
- Greptile benchmarks — 82% vs. 46% catch rate; vendor-published, methodology not fully public
- DevTools Academy state of AI code review 2025 — independent tool comparison
- Graphite prompt engineering guide — practitioner patterns
- Graphite context guide — full-repo vs. diff tradeoff analysis
- Addy Osmani — Code Review in the Age of AI (authoritative practitioner)
- Qodo 2025/2026 analysis — multi-agent patterns, tool landscape

### Tertiary (LOW confidence — needs validation during implementation)
- arXiv 2602.20478 — codified context for AI agents; context injection approaches
- PackMind convention detection guide — convention detection pitfalls and staleness
- OpenReview — LLM uncertainty expression failure modes

---
*Research completed: 2026-03-04*
*Ready for roadmap: yes*

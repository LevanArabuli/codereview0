---
phase: 02-context-infrastructure
plan: 02
subsystem: context
tags: [prompt-injection, xml-tags, exploration-guidance, cli-wiring, review-context]

# Dependency graph
requires:
  - phase: 02-context-infrastructure plan 01
    provides: ReviewContext types, gatherQuickContext, buildExplorationGuidance, fetchFileContent
provides:
  - buildPrompt accepting ReviewContext with related file XML injection
  - buildAgenticPrompt accepting ReviewContext with structured per-file exploration guidance
  - CLI pipeline wiring context gathering between fetchPRData and prompt construction
  - Verbose context stats output following [debug] pattern
affects: [prompt-quality, deep-review-guidance, phase-04-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "XML tag injection for related file context in prompts"
    - "Per-file structured exploration guidance replacing generic categories"
    - "Best-effort context gathering with try/catch wrapping"

key-files:
  created: []
  modified:
    - src/prompt.ts
    - src/analyzer.ts
    - src/cli.ts
    - tests/prompt.test.ts

key-decisions:
  - "Related files placed after </diff> and before finding format instructions in quick mode prompt"
  - "Exploration guidance uses per-file headers (### filename) with category bullets"
  - "Context parameter threaded through analyzer functions as last optional parameter"

patterns-established:
  - "ReviewContext as optional third parameter on prompt/analyzer functions (backward compatible)"
  - "Best-effort context gathering: try/catch with verbose-only error logging"
  - "Verbose context stats: reason breakdown (N imports, N tests) in debug output"

requirements-completed: [CTX-01, CTX-02]

# Metrics
duration: 4min
completed: 2026-03-04
---

# Phase 2 Plan 02: Context Pipeline Wiring Summary

**Related file XML injection in quick mode prompts, structured per-file exploration guidance in deep mode prompts, and CLI pipeline orchestration for context gathering**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T13:46:42Z
- **Completed:** 2026-03-04T13:50:55Z
- **Tasks:** 2 (1 TDD, 1 standard)
- **Files modified:** 4

## Accomplishments
- buildPrompt renders `<related_file path="..." reason="...">` XML tags when ReviewContext.relatedFiles is provided
- buildAgenticPrompt replaces generic exploration section with per-file category guidance (callers, tests, type-definitions) when ReviewContext.explorationGuidance is provided
- CLI orchestrates context gathering between fetchPRData and prompt construction for both quick and deep modes
- Deep mode fallback path also gathers quick context when clone fails
- Verbose mode shows context stats with reason breakdown
- 14 new tests for prompt context integration (298 total tests passing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend prompt functions (RED)** - `417ea78` (test)
2. **Task 1: Extend prompt functions (GREEN)** - `da281aa` (feat)
3. **Task 2: Wire context gathering into CLI** - `95b3f84` (feat)

_TDD tasks have RED (test) and GREEN (feat) commits._

## Files Created/Modified
- `src/prompt.ts` - Added formatRelatedFiles helper, extended buildPrompt and buildAgenticPrompt with ReviewContext parameter
- `src/analyzer.ts` - Added ReviewContext parameter to analyzeDiff and analyzeAgentic, threaded through to prompt functions
- `src/cli.ts` - Wired gatherQuickContext for quick mode, buildExplorationGuidance for deep mode, fallback context gathering
- `tests/prompt.test.ts` - 14 new tests for related file XML injection and structured exploration guidance

## Decisions Made
- Related files section placed after `</diff>` and before finding format instructions to give Claude context before asking for output format
- Per-file exploration guidance uses markdown headers (`### filename`) with category bullet points matching the generic exploration format
- Context parameter added as last optional parameter on all functions to preserve backward compatibility
- Verbose context stats include reason breakdown (e.g., "2 imports, 1 tests") using reduce aggregation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 2 complete: context infrastructure fully wired from data layer to prompt construction to CLI orchestration
- ReviewContext flows through the entire pipeline: types.ts -> context.ts -> cli.ts -> analyzer.ts -> prompt.ts
- Ready for Phase 3 (prompt engineering) and Phase 4 (integration) which can build on this context infrastructure

## Self-Check: PASSED

All files exist, all commits verified, all exports present, 298/298 tests pass.

---
*Phase: 02-context-infrastructure*
*Completed: 2026-03-04*

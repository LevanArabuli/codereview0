---
phase: 04-context-aware-review-pipeline
plan: 01
subsystem: prompt
tags: [intent-extraction, pr-intent, prompt-calibration, review-context]

# Dependency graph
requires:
  - phase: 02-context-infrastructure
    provides: ReviewContext type with optional fields for prompt construction
  - phase: 03-prompt-foundations
    provides: Shared prompt constants (FINDING_FORMAT_INSTRUCTIONS, SEVERITY_EXAMPLES)
provides:
  - extractIntent() function for PR intent classification (5 categories + unknown)
  - PRIntent type exported from prompt.ts
  - getIntentGuidance() internal function for intent-specific prompt text
  - ReviewContext.intent field for threading intent through pipeline
affects: [04-02, deep-mode, quick-mode, cli-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns: [intent-based-review-calibration, priority-ordered-regex-matching, body-fallback-detection]

key-files:
  created: []
  modified:
    - src/types.ts
    - src/prompt.ts
    - src/cli.ts
    - tests/prompt.test.ts

key-decisions:
  - "Intent priority ordering: bugfix > refactor > dependency > docs-config > feature (prevents compound titles from misclassifying)"
  - "Intent guidance placed between </pr_metadata> and <diff> tags in both prompt functions (positioned early for maximum influence)"
  - "Every non-unknown intent guidance includes safety clause: bugs/security always reported regardless of intent"
  - "Body fallback uses stricter patterns than title matching to reduce false positives"

patterns-established:
  - "Intent extraction: regex-based classification with priority ordering and body fallback"
  - "Intent guidance: internal getIntentGuidance() returns empty string for unknown (no-op pattern for backward compatibility)"

requirements-completed: [PROMPT-02]

# Metrics
duration: 4min
completed: 2026-03-04
---

# Phase 4 Plan 1: PR Intent Extraction Summary

**extractIntent() classifying 5 PR intent categories with priority ordering, body fallback, and intent-calibrated review guidance in both quick and deep mode prompts**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T15:51:18Z
- **Completed:** 2026-03-04T15:55:05Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- extractIntent() correctly classifies bugfix, refactor, feature, dependency, docs-config, and unknown intents from PR titles with priority ordering
- Intent guidance appears in both buildPrompt and buildAgenticPrompt when intent is non-unknown, positioned between pr_metadata and diff sections
- CLI extracts intent once after fetching PR data and threads it through ReviewContext for all 3 code paths (deep, deep-fallback, quick)
- All existing 60 prompt tests pass unchanged; 33 new intent tests added; full suite 343/343 pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Intent extraction and prompt integration with TDD**
   - `46d94bc` (test): add failing tests for intent extraction and prompt integration (RED)
   - `3ef3240` (feat): implement intent extraction and prompt integration (GREEN)
2. **Task 2: Wire intent extraction into CLI pipeline** - `18309e7` (feat)

## Files Created/Modified
- `src/types.ts` - Added `intent?: string` field to ReviewContext interface
- `src/prompt.ts` - Added PRIntent type, extractIntent(), getIntentGuidance(), integrated intent guidance into buildPrompt and buildAgenticPrompt
- `src/cli.ts` - Import extractIntent, extract intent after fetch, thread into all 3 code paths with verbose debug output
- `tests/prompt.test.ts` - 33 new tests covering extractIntent classification, buildPrompt intent guidance, buildAgenticPrompt intent guidance

## Decisions Made
- Intent priority ordering: bugfix > refactor > dependency > docs-config > feature -- ensures compound titles like "fix and add feature" correctly classify as bugfix
- Intent guidance positioned between `</pr_metadata>` and `<diff>` tags -- placed early in the prompt for maximum influence on review calibration
- Every non-unknown intent guidance includes safety clause about bugs/security always being reported regardless of intent
- Body fallback uses stricter patterns than title matching to reduce false positive intent detection from PR descriptions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Intent extraction infrastructure ready for Phase 4 Plan 2 (convention scan)
- ReviewContext.intent field available for any future context-aware prompt features
- All tests pass, build succeeds, TypeScript compiles clean

## Self-Check: PASSED

- All 4 modified files exist on disk
- All 3 commits verified in git log (46d94bc, 3ef3240, 18309e7)
- 343/343 tests pass, TypeScript compiles clean, build succeeds

---
*Phase: 04-context-aware-review-pipeline*
*Completed: 2026-03-04*

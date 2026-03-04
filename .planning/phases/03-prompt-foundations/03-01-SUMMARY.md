---
phase: 03-prompt-foundations
plan: 01
subsystem: prompt
tags: [prompt-engineering, few-shot, severity-calibration, anti-examples]

# Dependency graph
requires:
  - phase: none
    provides: n/a
provides:
  - SEVERITY_EXAMPLES shared constant with 4 few-shot severity anchoring examples
  - Expanded MODE_OVERLAYS.balanced with concrete anti-examples
affects: [04-integration, prompt-tuning]

# Tech tracking
tech-stack:
  added: []
  patterns: [few-shot severity anchoring, anti-example noise suppression]

key-files:
  created: []
  modified: [src/prompt.ts, tests/prompt.test.ts]

key-decisions:
  - "SEVERITY_EXAMPLES placed after FINDING_FORMAT_INSTRUCTIONS and before scope guidance in both prompt functions"
  - "Anti-examples use plain code format (not diff format) to avoid confusion with actual PR diffs"
  - "4 anti-examples in balanced mode: unused var (ts6133), missing return type, implicit any (ts7006), trailing newline"

patterns-established:
  - "Few-shot severity anchoring: shared constant with code snippet + expected JSON finding per severity level"
  - "Anti-example framing: 'This is NOT a finding' prefix with concrete code showing pattern to skip"

requirements-completed: [PROMPT-01, PROMPT-03]

# Metrics
duration: 2min
completed: 2026-03-04
---

# Phase 3 Plan 1: Severity Anchoring and Anti-Examples Summary

**Few-shot severity examples (bug/security/suggestion/nitpick) as shared SEVERITY_EXAMPLES constant, plus 4 concrete anti-examples in balanced mode with "This is NOT a finding" framing for TypeScript noise suppression**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-04T14:28:02Z
- **Completed:** 2026-03-04T14:30:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added SEVERITY_EXAMPLES shared constant with language-agnostic few-shot examples for all 4 severity levels (bug: null-safety, security: SQL injection, suggestion: imperative loop, nitpick: unused import)
- Expanded MODE_OVERLAYS.balanced with 4 concrete anti-examples covering TypeScript compiler-catchable issues (unused vars TS6133, implicit any TS7006, missing return type) and style noise (trailing newline)
- Inserted SEVERITY_EXAMPLES identically into both buildPrompt() and buildAgenticPrompt() preventing drift
- Added 5 new test assertions covering anti-example presence, TypeScript mention, mode exclusivity, severity example completeness, and shared constant identity

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SEVERITY_EXAMPLES constant and expand balanced mode anti-examples** - `8df7ffa` (feat)
2. **Task 2: Full test suite regression check and type validation** - no commit (verification-only, all 304 tests green)

## Files Created/Modified
- `src/prompt.ts` - Added SEVERITY_EXAMPLES constant (30 lines), expanded MODE_OVERLAYS.balanced with 4 anti-examples, inserted severity examples into both buildPrompt() and buildAgenticPrompt()
- `tests/prompt.test.ts` - Added 2 new describe blocks with 5 test assertions for anti-examples and severity anchoring

## Decisions Made
- Placed SEVERITY_EXAMPLES after FINDING_FORMAT_INSTRUCTIONS (fields first, then examples) for natural reading order
- Used plain code format for anti-examples (not diff format) to avoid confusion with actual PR diff content
- Kept severity examples language-agnostic (generic patterns) since the tool reviews any language
- Anti-examples focus on TypeScript noise per user decision: unused vars (ts6133), missing return type on private method, implicit any (ts7006), plus trailing newline as style noise

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Prompt foundations complete for PROMPT-01 and PROMPT-03
- Severity examples and anti-examples are ready for Phase 4 integration
- No blockers for remaining phases

## Self-Check: PASSED

- [x] src/prompt.ts exists and contains SEVERITY_EXAMPLES (3 references: 1 const + 2 insertions)
- [x] tests/prompt.test.ts exists with new test blocks
- [x] 03-01-SUMMARY.md exists
- [x] Commit 8df7ffa verified in git log
- [x] All 304 tests pass, TypeScript type check clean

---
*Phase: 03-prompt-foundations*
*Completed: 2026-03-04*

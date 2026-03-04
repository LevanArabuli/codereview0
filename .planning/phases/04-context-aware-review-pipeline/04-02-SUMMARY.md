---
phase: 04-context-aware-review-pipeline
plan: 02
subsystem: prompt
tags: [convention-scan, agentic-prompt, code-review, patterns]

# Dependency graph
requires:
  - phase: 04-context-aware-review-pipeline/01
    provides: intent extraction and PRFile type in prompt module
provides:
  - buildConventionScanInstructions function for agentic prompt convention detection
  - Convention scan section in deep mode prompts with directory-aware scanning
affects: [prompt, analyzer]

# Tech tracking
tech-stack:
  added: []
  patterns: [convention-scan-before-review, directory-extraction-from-changed-files]

key-files:
  created: []
  modified:
    - src/prompt.ts
    - tests/prompt.test.ts

key-decisions:
  - "Convention scan placed before pr_metadata for scan-first flow (read conventions before seeing diff)"
  - "Directory list uses Set deduplication with split/pop pattern for extracting parent dirs"
  - "Root-level files (no directory) map to '.' as convention scan directory"
  - "Style conventions (indentation, semicolons, quotes) explicitly excluded -- linter's job"

patterns-established:
  - "Convention scan section: structural pattern categories (naming, error handling, imports, module structure)"
  - "file:line evidence requirement for convention violation findings"

requirements-completed: [PROMPT-04]

# Metrics
duration: 3min
completed: 2026-03-04
---

# Phase 4 Plan 2: Convention Scan Summary

**Convention scan instructions in agentic prompt -- reads 2-3 sibling files per changed directory to detect naming, error handling, import, and module structure patterns before reviewing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-04T15:57:59Z
- **Completed:** 2026-03-04T16:00:30Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added buildConventionScanInstructions() function that extracts unique directories from changed files
- Wired convention scan into buildAgenticPrompt before pr_metadata for scan-first flow
- Convention scan covers 4 structural pattern categories, excludes style, requires file:line evidence
- Quick mode (buildPrompt) correctly excludes convention scan
- 11 new tests covering all convention scan behaviors; all 354 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Convention scan instructions for deep mode with TDD** - `6a572dc` (feat)

## Files Created/Modified
- `src/prompt.ts` - Added buildConventionScanInstructions() function and wired into buildAgenticPrompt
- `tests/prompt.test.ts` - Added 11 convention scan tests, moved multiFilePR to top-level scope

## Decisions Made
- Convention scan placed before pr_metadata (after security constraints) for scan-first flow -- Claude reads conventions before seeing diff
- Root-level files (no directory separator) map to '.' directory in convention scan
- Style conventions explicitly excluded with "linter's job" framing to prevent redundant findings
- multiFilePR mock moved to top-level scope for reuse across multiple describe blocks

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Convention scan complete; all Phase 4 plans now delivered
- Full pipeline: intent extraction (04-01) + convention scanning (04-02) integrated into agentic prompt
- All 354 tests pass, TypeScript strict mode clean, build succeeds

---
*Phase: 04-context-aware-review-pipeline*
*Completed: 2026-03-04*

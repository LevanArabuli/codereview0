---
phase: 02-context-infrastructure
plan: 01
subsystem: context
tags: [octokit, imports, regex, type-system, budget-enforcement]

# Dependency graph
requires: []
provides:
  - ReviewContext, RelatedFile, ExplorationCategory type interfaces
  - fetchFileContent function for single-file GitHub API retrieval
  - Import parsing (extractRelativeImports) via regex for TS/JS
  - Naming pattern inference (inferRelatedByNaming) for test/barrel files
  - discoverRelatedFiles orchestrating discovery with dedup and priority
  - gatherQuickContext with budget enforcement (5 files, 50KB/file, 200KB total)
  - buildExplorationGuidance for deep mode per-file category guidance
affects: [02-02, prompt-integration, cli-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-phase context gathering: discover candidates then fetch with budget"
    - "Regex import parsing for TS/JS (no AST dependency)"
    - "Silent null return pattern for best-effort file fetching"
    - "Priority-based deduplication with reason ranking"

key-files:
  created:
    - src/context.ts
    - tests/context.test.ts
  modified:
    - src/types.ts
    - src/github.ts
    - tests/github.test.ts
    - tests/security.test.ts
    - SECURITY.md
    - CLAUDE.md

key-decisions:
  - "50KB per-file size limit and 200KB total budget for context"
  - "repos.getContent added to Octokit allowlist as read-only API"
  - "Import resolution generates extension candidates rather than filesystem check"

patterns-established:
  - "Reason priority ordering: import > test > type > barrel"
  - "Budget enforcement: skip (not truncate) oversized files"
  - "Code-only filter via CODE_EXTENSIONS constant"

requirements-completed: [CTX-02, CTX-03]

# Metrics
duration: 6min
completed: 2026-03-04
---

# Phase 2 Plan 01: Context Data Layer Summary

**ReviewContext types, fetchFileContent via Octokit repos.getContent, regex-based import parsing, naming pattern discovery, and budget-enforced context gathering for quick/deep modes**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-04T13:38:13Z
- **Completed:** 2026-03-04T13:44:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 8

## Accomplishments
- ReviewContext, RelatedFile, ExplorationCategory types in types.ts serve as shared data contract (CTX-03)
- fetchFileContent handles base64 decode, directory/symlink/error edge cases with null fallback
- Import parsing via regex handles ES module imports, CommonJS require, side-effect imports
- Context discovery pipeline: extract imports, resolve paths, infer naming patterns, deduplicate, prioritize
- Budget enforcement: 5-file cap, 50KB per-file skip, 200KB total budget
- buildExplorationGuidance generates per-file categories for deep mode
- 26 new tests (5 github + 21 context) with full suite at 284 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: ReviewContext type and fetchFileContent (RED)** - `99d721f` (test)
2. **Task 1: ReviewContext type and fetchFileContent (GREEN)** - `3a19d2b` (feat)
3. **Task 2: Context discovery module (RED)** - `add2dc4` (test)
4. **Task 2: Context discovery module (GREEN)** - `02cd33c` (feat)

_TDD tasks have RED (test) and GREEN (feat) commits._

## Files Created/Modified
- `src/types.ts` - Added RelatedFile, ExplorationCategory, ReviewContext interfaces
- `src/github.ts` - Added fetchFileContent using Octokit repos.getContent with base64 decode
- `src/context.ts` - New module: import parsing, naming patterns, discovery, fetching, exploration guidance
- `tests/github.test.ts` - 5 new tests for fetchFileContent edge cases
- `tests/context.test.ts` - 21 tests covering imports, resolution, naming, dedup, budget, guidance
- `tests/security.test.ts` - Added repos.getContent to Octokit allowlist
- `SECURITY.md` - Documented repos.getContent in API surface audit
- `CLAUDE.md` - Updated read-only API surface list

## Decisions Made
- Per-file size limit set at 50,000 characters (~12,500 tokens) -- skip, not truncate
- Total budget set at 200,000 characters (~50,000 tokens) -- leaves room for diff + prompt
- repos.getContent added to security allowlist as read-only method consistent with security model
- Import resolution generates candidate paths with multiple extensions rather than checking filesystem

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed resolveImportPath treating .test as a file extension**
- **Found during:** Task 2 (context module implementation)
- **Issue:** `extname('foo.test')` returns `.test`, causing the resolver to treat `./foo.test` as a complete path instead of generating candidates like `foo.test.ts`
- **Fix:** Changed extension check to only recognize CODE_EXTENSIONS (.ts, .tsx, .js, .jsx) as "already has extension"
- **Files modified:** src/context.ts
- **Verification:** Dedup test passes -- imports through `./foo.test` correctly resolve to `foo.test.ts`
- **Committed in:** 02cd33c (Task 2 GREEN commit)

**2. [Rule 1 - Bug] Updated security test allowlist for repos.getContent**
- **Found during:** Task 2 (full suite regression check)
- **Issue:** Security test enforces Octokit method allowlist; repos.getContent was not listed
- **Fix:** Added repos.getContent to allowedMethods set in security.test.ts, updated SECURITY.md and CLAUDE.md
- **Files modified:** tests/security.test.ts, SECURITY.md, CLAUDE.md
- **Verification:** All 39 security tests pass, 284 total tests pass
- **Committed in:** 02cd33c (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
- Budget test initially used 80KB files which exceeded the 50KB per-file limit, causing 0 results instead of budget-capped results. Fixed test data to use 45KB files to properly test total budget enforcement.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Types (ReviewContext, RelatedFile, ExplorationCategory) ready for Plan 02 to consume in prompt construction
- fetchFileContent ready for CLI integration to fetch changed file contents for import parsing
- gatherQuickContext and buildExplorationGuidance ready to wire into cli.ts pipeline
- All exports documented and tested for Plan 02 integration

## Self-Check: PASSED

All files exist, all commits verified, all exports present, 284/284 tests pass.

---
*Phase: 02-context-infrastructure*
*Completed: 2026-03-04*

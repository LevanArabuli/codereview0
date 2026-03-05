# Roadmap: codereview — Agent Team Support

## Overview

This milestone adds parallel multi-agent review to an existing production-quality single-agent CLI. Two phases deliver the feature in dependency order: the schema and prompt foundation combined with the parallel orchestration engine and security hardening, then the output extensions that surface aspect-grouped findings to users. The existing single-agent paths are preserved throughout and serve as graceful degradation targets.

## Phases

**Phase Numbering:**
- Integer phases (1, 2): Planned milestone work
- Decimal phases (1.1, 1.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Orchestration Foundation** - Establish the `aspect` schema field, build expert-scoped prompt templates, implement the fan-out orchestrator, deduplication, graceful degradation, and security hardening
- [ ] **Phase 2: Output Integration** - Extend terminal output to render aspect-grouped findings with progress indicators and summary counts per aspect

## Phase Details

### Phase 1: Orchestration Foundation
**Goal**: The schema, prompt templates, parallel orchestration engine, and security hardening are in place — the tool fans out to four concurrent Claude subprocesses and returns a merged, deduplicated `ReviewFinding[]` with aspect tags
**Depends on**: Nothing (first phase)
**Requirements**: SYNTH-02, ORCH-06, ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05, SYNTH-01, SYNTH-03, SEC-01, SEC-02
**Success Criteria** (what must be TRUE):
  1. A `ReviewFinding` object can carry an optional `aspect` field (`'security' | 'performance' | 'quality' | 'tests'`) and existing tests still pass
  2. Four aspect-specific prompt templates exist, each scoped to its domain (security vulnerabilities, performance bottlenecks, code quality issues, test coverage gaps) and distinct from the generalist prompt
  3. Running a quick-mode review launches four concurrent `claude -p` subprocesses and produces a single merged `ReviewFinding[]` with `aspect` tags within the review's timeout window
  4. Running a deep-mode review with a cloned repo also fans out to four aspect agents and produces aspect-tagged findings
  5. When one aspect agent fails or times out, the remaining three aspects still complete and their findings appear in the output
  6. Running with `--no-team` produces a single-agent review and prints a message confirming single-agent mode
  7. `filterEnv()` strips `ANTHROPIC_BASE_URL` from all subprocess environments, and a security test in `security.test.ts` covers this boundary
  8. Findings that appear in multiple aspects are deduplicated in the merged output (same file, line, and description does not appear twice)
**Plans:** 3 plans

Plans:
- [ ] 01-01-PLAN.md — Schema, prompt, and security foundations (aspect field, prompt overlays, filterEnv)
- [ ] 01-02-PLAN.md — Orchestrator core (fan-out, dedup, merge, partial failure)
- [ ] 01-03-PLAN.md — CLI wiring (--no-team flag, orchestrator routing, fallback)

### Phase 2: Output Integration
**Goal**: Users see aspect-grouped findings in the terminal with progress indicators during the review and summary counts per aspect
**Depends on**: Phase 1
**Requirements**: SYNTH-04, OUT-01, OUT-02
**Success Criteria** (what must be TRUE):
  1. Terminal output displays findings grouped under labeled section headers per aspect (e.g., "Security: 3 findings", "Performance: no issues")
  2. During a team review, the terminal shows a per-aspect progress line as each agent completes (e.g., "Analyzing security... done")
  3. Each aspect with findings has its own named section header in the terminal output, with findings listed beneath it
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Orchestration Foundation | 0/3 | Not started | - |
| 2. Output Integration | 0/TBD | Not started | - |

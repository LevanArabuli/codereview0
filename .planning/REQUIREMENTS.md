# Requirements: codereview

**Defined:** 2026-03-04
**Core Value:** Produce code review feedback that's as useful as a senior engineer's review -- context-aware, well-prioritized, and focused on what actually matters.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Prompt Quality

- [x] **PROMPT-01**: Balanced mode overlay includes concrete anti-examples of what NOT to flag (trailing newlines, missing JSDoc on private methods, issues TypeScript already catches)
- [ ] **PROMPT-02**: Review derives PR intent from title/description and calibrates finding severity against that goal
- [x] **PROMPT-03**: Prompt includes few-shot examples of each severity level (bug, security, suggestion, nitpick) anchoring the model's labels to observable characteristics
- [ ] **PROMPT-04**: Deep mode performs a convention scan phase before reviewing -- reads 2-3 representative files near changed files to identify naming, error handling, and structural patterns

### Context Gathering

- [x] **CTX-01**: Deep mode prompt explicitly guides Claude on which adjacent files to explore (callers, tests, type definitions for changed modules)
- [x] **CTX-02**: Quick mode fetches 3-5 related files via Octokit /contents API (imports, tests, types) to enrich context beyond the diff
- [x] **CTX-03**: ReviewContext type serves as shared data contract between quick and deep modes for gathered context

### Output Filtering

- [x] **FILT-01**: Duplicate findings at the same file+line+category are merged, keeping the highest-severity version
- [x] **FILT-02**: Confidence label displayed only on medium/low findings (absence of label implies high confidence)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Filtering

- **FILT-03**: --min-confidence flag to filter findings below confidence threshold before rendering
- **FILT-04**: Structured convention detection output (emit detected conventions as reusable metadata)

### Advanced Context

- **CTX-04**: Evidence-grounded cross-file findings require file:line citations for all high-severity findings
- **CTX-05**: Structured convention detection output reusable across repeated runs on the same repo

### Learning

- **LEARN-01**: Mode recommendation based on PR characteristics (size, file types, risk signals)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Auto-fix generation beyond suggestedFix | Generates churn; teaches developers to stop thinking critically |
| Repo-wide semantic indexing / vector embeddings | Incompatible with CLI tool that runs once per invocation; deep mode clone achieves same goal |
| Learning from feedback / dismissal memory | Requires persistent state, identity model; use mode overlays instead |
| Multi-agent orchestration (security agent, perf agent) | Single well-prompted Claude outperforms poorly-coordinated multi-agent for PR-scale analysis |
| PR summary generation as published output | Moves tool toward assistant rather than reviewer; keep intent extraction internal |
| Blocking merge gates / required status checks | Advisory only; PENDING reviews are non-blocking by design |
| Request-changes or auto-approve verdicts | AI review must remain advisory; never implement approve or request-changes |
| New runtime dependencies | All improvements achievable within existing 4-dep budget |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PROMPT-01 | Phase 3 | Complete |
| PROMPT-02 | Phase 4 | Pending |
| PROMPT-03 | Phase 3 | Complete |
| PROMPT-04 | Phase 4 | Pending |
| CTX-01 | Phase 2 | Complete |
| CTX-02 | Phase 2 | Complete |
| CTX-03 | Phase 2 | Complete |
| FILT-01 | Phase 1 | Complete |
| FILT-02 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0

---
*Requirements defined: 2026-03-04*
*Last updated: 2026-03-04 after roadmap creation*

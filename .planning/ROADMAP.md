# Roadmap: codereview

## Overview

This milestone improves review judgment quality -- the difference between generic findings and findings that feel like a senior engineer who knows the codebase wrote them. The work proceeds from isolated pure functions (filtering) and independent infrastructure (context gathering, prompt content) toward a final integration phase that wires everything into the CLI pipeline. Four phases deliver nine requirements, moving from foundation to integration.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Output Filtering** - Post-analysis finding deduplication and confidence-aware display
- [ ] **Phase 2: Context Infrastructure** - ReviewContext type and context gathering for both quick and deep modes
- [ ] **Phase 3: Prompt Foundations** - Severity anchoring examples and balanced mode anti-examples in prompt templates
- [ ] **Phase 4: Context-Aware Review Pipeline** - Intent-aware review, convention scanning, and full pipeline integration

## Phase Details

### Phase 1: Output Filtering
**Goal**: Findings that reach the user are deduplicated and display confidence only when it adds information
**Depends on**: Nothing (first phase)
**Requirements**: FILT-01, FILT-02
**Success Criteria** (what must be TRUE):
  1. When Claude produces multiple findings at the same file, line, and category, only the highest-severity finding appears in output
  2. Findings with medium or low confidence display a confidence label in both terminal output and GitHub comments
  3. Findings with high confidence display no confidence label (absence implies high confidence)
  4. Bug and security findings are never suppressed regardless of confidence level
**Plans**: TBD

Plans:
- [ ] 01-01: TBD
- [ ] 01-02: TBD

### Phase 2: Context Infrastructure
**Goal**: Both review modes can gather structured codebase context before prompt construction
**Depends on**: Nothing (independent of Phase 1)
**Requirements**: CTX-01, CTX-02, CTX-03
**Success Criteria** (what must be TRUE):
  1. Deep mode prompt includes explicit guidance telling Claude which adjacent files to explore (callers, tests, type definitions of changed modules)
  2. Quick mode fetches 3-5 related files (imports, tests, types) via the Octokit contents API and includes them in the review context
  3. A ReviewContext type exists in types.ts and serves as the shared data contract consumed by both quick and deep mode prompt construction
  4. Context gathering respects budget caps (file count and size limits) to prevent context overload
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Prompt Foundations
**Goal**: Prompt templates anchor the model's severity labels and suppress low-value findings through concrete examples
**Depends on**: Nothing (independent of Phases 1 and 2)
**Requirements**: PROMPT-01, PROMPT-03
**Success Criteria** (what must be TRUE):
  1. The balanced mode overlay includes concrete anti-examples of what NOT to flag (trailing newlines, missing JSDoc on private methods, issues TypeScript already catches)
  2. The prompt includes few-shot examples of each severity level (bug, security, suggestion, nitpick) with observable characteristics that distinguish them
  3. Running the eval test suite after prompt changes shows no regression in review quality (no new false positives introduced)
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

### Phase 4: Context-Aware Review Pipeline
**Goal**: Reviews are calibrated against PR intent and codebase conventions, and the full quality pipeline (context, prompts, filtering) is wired end-to-end
**Depends on**: Phase 1, Phase 2, Phase 3
**Requirements**: PROMPT-02, PROMPT-04
**Success Criteria** (what must be TRUE):
  1. The review derives PR intent from the title and description, and finding severity is calibrated against that intent (e.g., a cleanup PR does not get flagged for missing new tests)
  2. Deep mode performs a convention scan phase before reviewing -- reading 2-3 representative files near changed files to identify naming, error handling, and structural patterns
  3. Convention context gathered during the scan appears in the review prompt and visibly influences finding content (findings reference detected patterns)
  4. The CLI orchestrates the full pipeline: context gathering before prompt construction, filtering after analysis
  5. All existing tests pass and the eval fixture suite shows no regression
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Output Filtering | 0/0 | Not started | - |
| 2. Context Infrastructure | 0/0 | Not started | - |
| 3. Prompt Foundations | 0/0 | Not started | - |
| 4. Context-Aware Review Pipeline | 0/0 | Not started | - |

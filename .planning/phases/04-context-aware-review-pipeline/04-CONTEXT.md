# Phase 4: Context-Aware Review Pipeline - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Reviews calibrated against PR intent and codebase conventions, with the full quality pipeline (context, prompts, filtering) wired end-to-end. Covers PROMPT-02 (intent-aware severity calibration) and PROMPT-04 (convention scanning before review). This is the integration phase that brings together Phases 1-3.

</domain>

<decisions>
## Implementation Decisions

### PR intent extraction
- Derive intent from PR title and description only (already in PRData) -- no diff signal analysis
- Recognize core categories: feature, bugfix, refactor, dependency update, docs/config
- Intent extraction works in both quick and deep modes (no extra API calls needed)
- Intent guides what gets flagged, NOT severity labels -- a refactor PR skips "add tests for new behavior" since there IS no new behavior, but a real bug is still severity "bug"

### Convention detection
- Structural patterns only: naming conventions, error handling patterns, import organization, module structure
- No style detection (indentation, semicolons, quotes) -- that overlaps with linters
- Prompt-guided scan: add a "Convention Scan" instruction section to the agentic prompt, Claude reads 2-3 sibling files before reviewing
- Deep mode only -- quick mode gets no convention awareness (requires repo access)
- Convention findings must reference the detected pattern explicitly with file:line evidence (e.g., "This module uses throw new AppError(...) for error handling (see auth.ts:45, db.ts:32), but this function uses raw throw")

### Pipeline visibility
- PR intent shown in --verbose mode only: `[debug] Intent: refactor (from title)` -- follows existing verbose pattern
- No separate "conventions detected" output -- conventions appear naturally in finding descriptions where they matter
- No changes to HTML report format -- better findings automatically mean better reports
- Keep MAX_AGENTIC_TURNS at 75 -- convention scanning is prompt-guided (2-3 file reads), not a multi-turn phase

### Full pipeline integration
- End-to-end order: fetch PR data -> gather context (Phase 2) -> build prompt with intent + conventions (Phase 4) + severity examples (Phase 3) -> analyze -> deduplicate findings (Phase 1) -> output
- Extend ReviewContext type with intent field for both modes
- Convention scan instructions added to agentic prompt only (deep mode)

### Claude's Discretion
- Exact intent category detection logic (keyword matching, heuristic rules, or freeform classification)
- Specific convention scan prompt wording and instruction placement in agentic prompt
- How many sibling files to suggest reading for convention detection (guideline: 2-3)
- How intent categories map to specific flagging adjustments in prompt text
- Whether to add intent as a prompt section or weave it into existing reviewer instructions

</decisions>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PRData.title` and `PRData.body` (types.ts): Already available for intent extraction -- no new fetching needed
- `ReviewContext` (types.ts): Shared data contract -- extend with `intent` field
- `SEVERITY_EXAMPLES` and `MODE_OVERLAYS` (prompt.ts): Phase 3 severity anchoring and anti-examples already in prompts
- `buildExplorationGuidance()` (context.ts): Existing deep mode guidance builder -- convention scan instructions extend this pattern
- `deduplicateFindings()` (dedup.ts): Phase 1 post-analysis filter already wired into handlePostAnalysis()
- `FINDING_FORMAT_INSTRUCTIONS` (prompt.ts): Shared constant pattern for prompt content -- intent/convention instructions should follow this pattern

### Established Patterns
- Shared prompt constants extracted to module level prevent drift between quick and deep mode (FINDING_FORMAT_INSTRUCTIONS, SEVERITY_EXAMPLES, JSON_RESPONSE_INSTRUCTION)
- ReviewContext threaded as optional last parameter for backward compatibility (Phase 2 decision)
- Verbose output follows `[debug] Label: value` single-line format
- Pipeline flows through cli.ts: fetch -> context -> prompt -> analyze -> dedup -> output

### Integration Points
- `buildPrompt()` (prompt.ts): Add intent-based flagging guidance for quick mode
- `buildAgenticPrompt()` (prompt.ts): Add intent guidance + convention scan instructions for deep mode
- `ReviewContext` (types.ts): Extend with intent field (both modes) -- convention scan is prompt-only, no data structure needed
- `cli.ts` pipeline: Intent extraction step between fetchPRData() and buildPrompt()/buildAgenticPrompt()
- `output.ts` printDebug: Intent verbose output

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 04-context-aware-review-pipeline*
*Context gathered: 2026-03-04*

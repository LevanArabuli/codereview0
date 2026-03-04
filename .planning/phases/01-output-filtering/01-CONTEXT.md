# Phase 1: Output Filtering - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Post-analysis finding deduplication and confidence-aware display. Findings that reach the user are deduplicated (same file+line+category keeps highest severity), and confidence labels appear only on medium/low findings. Covers FILT-01 and FILT-02. No new CLI flags, no confidence-based filtering (that's FILT-03, v2).

</domain>

<decisions>
## Implementation Decisions

### Deduplication matching
- Strict exact match on file+line+category only. No adjacent-line or fuzzy matching.
- When multiple findings share the same file+line+category, keep the highest-severity one
- Same-severity tiebreaker: keep the one with higher confidence. If confidence also equal, keep the first encountered
- Bug and security findings are still deduplicated when they collide at the same location (true duplicates are noise regardless of severity)
- Lower-severity duplicates are dropped silently — no appended notes or merged descriptions

### Dedup transparency
- Verbose-only: in `--verbose` mode, extend the existing `[debug] Findings: N raw, M posted` line to include dedup count (e.g., `[debug] Findings: 8 raw, 2 duplicates removed, 6 posted`)
- Silent in normal mode — users just see fewer, cleaner findings
- No separate debug line; all finding stats on one line

### Pipeline placement
- Dedup happens inside `handlePostAnalysis()`, at the start, before terminal output, HTML report, and GitHub posting
- Single dedup point serves both quick and deep mode branches
- All outputs (terminal, GitHub comments, HTML report) show the same deduplicated findings — consistent everywhere

### Confidence label display
- Medium and low confidence findings show a confidence label in both terminal output and GitHub comments
- High confidence findings show no confidence label (absence implies high confidence)
- Applies to all output surfaces: terminal (`printFindings`), GitHub inline comments (`formatInlineComment`), off-diff review body (`buildReviewBody`), and HTML report

### Claude's Discretion
- Exact confidence label format/styling in terminal output (e.g., `[medium]`, `(medium confidence)`, dimmed text)
- Confidence label format in GitHub markdown comments
- Whether HTML report confidence labels use color, badges, or text
- Internal implementation of the dedup function (standalone module vs inline in existing modules)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ReviewFinding` (schemas.ts): Already has `file`, `line`, `severity`, `confidence`, `category` — all dedup keys present in the type
- `SEVERITY_ORDER` (output.ts:165): Existing severity ranking map (`bug:0, security:1, suggestion:2, nitpick:3`) — reusable for dedup severity comparison
- `CONFIDENCE_ORDER` (output.ts:173): Existing confidence ranking map (`high:0, medium:1, low:2`) — reusable for tiebreaker logic
- `handlePostAnalysis()` (cli.ts:36): Central pipeline function where dedup filter will be inserted

### Established Patterns
- Findings are passed as `ReviewFinding[]` arrays through the pipeline — dedup is a pure array filter that fits naturally
- Verbose debug output uses `printDebug()` with `[debug]` prefix — dedup stats follow this pattern
- `formatter.ts` and `review-builder.ts` both format confidence as `` `[${finding.confidence}]` `` — conditional logic needed in both

### Integration Points
- `handlePostAnalysis()` in cli.ts is the single insertion point for dedup (before `printAnalysisSummary`, `printFindings`, `generateHtmlReport`, and `postReview`)
- `formatInlineComment()` in formatter.ts — conditionally include confidence label
- `buildReviewBody()` in review-builder.ts — conditionally include confidence label
- `printFindings()` in output.ts — add confidence label for medium/low findings
- HTML report rendering — add confidence label for medium/low findings

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-output-filtering*
*Context gathered: 2026-03-04*

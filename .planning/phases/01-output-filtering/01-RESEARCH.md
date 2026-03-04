# Phase 1: Output Filtering - Research

**Researched:** 2026-03-04
**Domain:** Array filtering, deduplication logic, conditional output formatting
**Confidence:** HIGH

## Summary

Phase 1 implements two discrete features: (1) deduplication of findings that share the same file+line+category, keeping only the highest-severity entry, and (2) conditional confidence label display where only medium/low confidence findings show a label. Both features operate on `ReviewFinding[]` arrays and modify existing output functions. No external libraries are needed -- all work uses existing types, constants, and patterns already in the codebase.

The codebase is well-structured for these changes. The `handlePostAnalysis()` function in `cli.ts` serves as the single pipeline choke point where dedup can be inserted before all output paths. The `SEVERITY_ORDER` and `CONFIDENCE_ORDER` maps in `output.ts` provide the ranking logic needed for dedup tiebreakers. The `ReviewFinding` type already carries `file`, `line`, `severity`, `confidence`, and `category` fields -- all dedup keys are present without schema changes.

**Primary recommendation:** Implement dedup as a pure function (array in, array out) placed at the top of `handlePostAnalysis()`, then modify four output surfaces to conditionally show confidence labels only for medium/low confidence.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Strict exact match on file+line+category only. No adjacent-line or fuzzy matching.
- When multiple findings share the same file+line+category, keep the highest-severity one
- Same-severity tiebreaker: keep the one with higher confidence. If confidence also equal, keep the first encountered
- Bug and security findings are still deduplicated when they collide at the same location (true duplicates are noise regardless of severity)
- Lower-severity duplicates are dropped silently -- no appended notes or merged descriptions
- Verbose-only: in `--verbose` mode, extend the existing `[debug] Findings: N raw, M posted` line to include dedup count (e.g., `[debug] Findings: 8 raw, 2 duplicates removed, 6 posted`)
- Silent in normal mode -- users just see fewer, cleaner findings
- No separate debug line; all finding stats on one line
- Dedup happens inside `handlePostAnalysis()`, at the start, before terminal output, HTML report, and GitHub posting
- Single dedup point serves both quick and deep mode branches
- All outputs (terminal, GitHub comments, HTML report) show the same deduplicated findings -- consistent everywhere
- Medium and low confidence findings show a confidence label in both terminal output and GitHub comments
- High confidence findings show no confidence label (absence implies high confidence)
- Applies to all output surfaces: terminal (`printFindings`), GitHub inline comments (`formatInlineComment`), off-diff review body (`buildReviewBody`), and HTML report

### Claude's Discretion
- Exact confidence label format/styling in terminal output (e.g., `[medium]`, `(medium confidence)`, dimmed text)
- Confidence label format in GitHub markdown comments
- Whether HTML report confidence labels use color, badges, or text
- Internal implementation of the dedup function (standalone module vs inline in existing modules)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FILT-01 | Duplicate findings at the same file+line+category are merged, keeping the highest-severity version | Dedup function using `SEVERITY_ORDER` and `CONFIDENCE_ORDER` maps, composite key `${file}:${line}:${category}`, inserted at top of `handlePostAnalysis()` |
| FILT-02 | Confidence label displayed only on medium/low findings (absence of label implies high confidence) | Conditional logic in `formatInlineComment()`, `buildReviewBody()`, `printFindings()`, and HTML report `renderAnnotation()` -- check `finding.confidence !== 'high'` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.x | Type-safe implementation | Already configured with strict mode |
| Vitest | 4.0.x | Unit testing | Already the project test framework |
| picocolors | 1.1.x | Terminal styling for confidence labels | Already the project color library |

### Supporting
No additional libraries needed. This phase uses only built-in language features (Map, Array, string template literals) and existing project utilities.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual Map-based dedup | lodash `_.uniqBy` | Project has 4-dep budget, manual approach is ~15 lines and more explicit |
| String composite key | Structured object key with JSON.stringify | String concatenation is simpler and sufficient for exact-match semantics |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  dedup.ts          # New: deduplicateFindings() pure function
  cli.ts            # Modified: call dedup at top of handlePostAnalysis()
  output.ts         # Modified: confidence label in printFindings()
  formatter.ts      # Modified: conditional confidence in formatInlineComment()
  review-builder.ts # Modified: conditional confidence in buildReviewBody()
  html-report.ts    # Modified: confidence label/badge in renderAnnotation()
tests/
  dedup.test.ts     # New: unit tests for dedup logic
  output.test.ts    # Modified: add confidence label display tests
  formatter.test.ts # New: unit tests for conditional confidence in inline comments
  review-builder.test.ts # New: unit tests for conditional confidence in review body
  html-report.test.ts    # Modified: add confidence label tests for HTML
```

### Pattern 1: Pure Dedup Function
**What:** A standalone pure function that takes `ReviewFinding[]` and returns a filtered `ReviewFinding[]`.
**When to use:** Dedup is a data transformation with no side effects -- ideal as a standalone, testable function.
**Example:**
```typescript
// src/dedup.ts
import type { ReviewFinding } from './schemas.js';

const SEVERITY_RANK: Record<string, number> = {
  bug: 0,
  security: 1,
  suggestion: 2,
  nitpick: 3,
};

const CONFIDENCE_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function deduplicateFindings(findings: ReviewFinding[]): {
  deduplicated: ReviewFinding[];
  removedCount: number;
} {
  const seen = new Map<string, ReviewFinding>();

  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.category}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, finding);
      continue;
    }

    // Keep higher severity (lower rank number)
    const existingRank = SEVERITY_RANK[existing.severity] ?? 9;
    const newRank = SEVERITY_RANK[finding.severity] ?? 9;

    if (newRank < existingRank) {
      seen.set(key, finding);
    } else if (newRank === existingRank) {
      // Same severity: keep higher confidence (lower rank number)
      const existingConf = CONFIDENCE_RANK[existing.confidence] ?? 9;
      const newConf = CONFIDENCE_RANK[finding.confidence] ?? 9;
      if (newConf < existingConf) {
        seen.set(key, finding);
      }
      // If confidence also equal, keep first encountered (existing stays)
    }
    // If new severity rank is higher (worse), keep existing
  }

  const deduplicated = [...seen.values()];
  return {
    deduplicated,
    removedCount: findings.length - deduplicated.length,
  };
}
```

### Pattern 2: Conditional Confidence Label
**What:** Helper function or inline conditional that produces a confidence label string only for non-high confidence.
**When to use:** All four output surfaces need this logic; centralizing avoids drift.
**Example:**
```typescript
// Could be in formatter.ts or a shared utility
export function confidenceLabel(confidence: string): string {
  return confidence === 'high' ? '' : ` \`[${confidence}]\``;
}
```

### Pattern 3: Pipeline Integration in handlePostAnalysis
**What:** Insert dedup call at the top of `handlePostAnalysis()`, track removed count for verbose output.
**When to use:** This is the locked decision from CONTEXT.md -- single insertion point.
**Example:**
```typescript
async function handlePostAnalysis(
  findings: ReviewFinding[],
  // ... other params
): Promise<void> {
  // Dedup at the very top
  const { deduplicated, removedCount } = deduplicateFindings(findings);
  findings = deduplicated;  // shadow parameter for rest of function

  // ... existing code uses `findings` which is now deduplicated

  // In verbose block, modify the debug line:
  if (options.verbose) {
    if (options.post) {
      // ... existing partition logic ...
      printDebug(`Findings: ${rawCount} raw, ${removedCount} duplicates removed, ${posted} posted`);
    } else {
      printDebug(`Findings: ${rawCount} raw, ${removedCount} duplicates removed`);
    }
  }
}
```

### Anti-Patterns to Avoid
- **Mutating the input array:** The dedup function must return a new array, not modify the input. The existing `printFindings` already follows this pattern with `[...findings].sort()`.
- **Duplicating severity/confidence ranking maps:** `SEVERITY_ORDER` and `CONFIDENCE_ORDER` already exist in `output.ts`. However, creating a separate dedup module with its own ranking maps is acceptable since dedup is logically independent. If DRY is important, the maps could be extracted to a shared location, but for 6 lines of constants this is not critical.
- **Filtering by confidence instead of just labeling:** FILT-03 (confidence-based filtering) is explicitly v2 and out of scope. This phase only changes display labels, never drops findings based on confidence.
- **Adding confidence to printAnalysisSummary:** The summary line (`2 bugs . 1 security . 3 suggestions`) is a count aggregation and does not display per-finding confidence. Do not modify it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| N/A | N/A | N/A | This phase uses only basic array operations and string formatting -- no complex problems that have existing library solutions |

**Key insight:** This phase is intentionally simple. The complexity is in getting the integration points right across four output surfaces, not in any algorithmically difficult operation.

## Common Pitfalls

### Pitfall 1: Dedup Key Collision on Different Lines
**What goes wrong:** Using a key that is too broad (e.g., `file:category` without `line`) would incorrectly merge distinct findings at different locations.
**Why it happens:** Attempting to be "smart" about merging similar findings.
**How to avoid:** Use strict exact-match key: `${file}:${line}:${category}`. This is a locked decision.
**Warning signs:** Test with findings at different lines in the same file with the same category -- both should survive.

### Pitfall 2: Order-Dependent Dedup Results
**What goes wrong:** If dedup uses a different iteration order (e.g., post-sort), findings that survive depend on sort order rather than original encounter order.
**Why it happens:** Processing findings after they've been sorted changes which one is "first encountered."
**How to avoid:** Dedup BEFORE any sorting. The dedup function receives findings in their original order from Claude. The tiebreaker for equal severity+confidence is "first encountered" which means first in the input array.
**Warning signs:** Non-deterministic output when findings have equal severity and confidence at the same location.

### Pitfall 3: Verbose Debug Line Counts Off By One
**What goes wrong:** The debug line shows wrong counts because `rawCount` is captured after dedup instead of before, or `posted` count is calculated before dedup.
**Why it happens:** The existing debug line already does `findings.length` which would reflect post-dedup count after the variable is reassigned.
**How to avoid:** Capture `rawCount = findings.length` BEFORE the dedup call. Use `removedCount` from the dedup result. Then `rawCount === deduplicated.length + removedCount`.
**Warning signs:** Test the verbose output explicitly with fixtures that produce duplicates.

### Pitfall 4: Confidence Label Breaks Existing Test Assertions
**What goes wrong:** Tests that assert on the exact format of inline comments or review bodies break when confidence labels are conditionally removed.
**Why it happens:** The existing `formatInlineComment` always includes `` `[${finding.confidence}]` `` on every finding.
**How to avoid:** Update existing tests to reflect the new conditional behavior. Add explicit test cases for high (no label), medium (has label), and low (has label).
**Warning signs:** Existing tests in `html-report.test.ts` may reference confidence in ways that break.

### Pitfall 5: HTML Report Confidence Inconsistency
**What goes wrong:** The HTML report shows confidence differently from terminal/GitHub, creating user confusion.
**Why it happens:** HTML report rendering is in a separate module with different rendering logic.
**How to avoid:** Apply the same conditional logic (show confidence only for medium/low) consistently across all four surfaces. Decide the HTML format during implementation but keep the conditional logic identical.
**Warning signs:** Manual testing the HTML report alongside terminal output and seeing different information.

## Code Examples

Verified patterns from the existing codebase:

### Existing Severity/Confidence Ranking (output.ts:165-177)
```typescript
// Already in the codebase -- reusable for dedup
const SEVERITY_ORDER: Record<string, number> = {
  bug: 0,
  security: 1,
  suggestion: 2,
  nitpick: 3,
};

const CONFIDENCE_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
```

### Current formatInlineComment (formatter.ts:21-41)
```typescript
// BEFORE: Always includes confidence
export function formatInlineComment(finding: ReviewFinding): string {
  const severity = capitalizeSeverity(finding.severity);
  let body = `**${severity}** \`[${finding.confidence}]\`\n\n${finding.description}`;
  // ...
}

// AFTER: Confidence only for medium/low
export function formatInlineComment(finding: ReviewFinding): string {
  const severity = capitalizeSeverity(finding.severity);
  const confLabel = finding.confidence === 'high' ? '' : ` \`[${finding.confidence}]\``;
  let body = `**${severity}**${confLabel}\n\n${finding.description}`;
  // ...
}
```

### Current buildReviewBody (review-builder.ts:38-50)
```typescript
// BEFORE: Always includes confidence
body += `\n- **${severity}** \`[${f.confidence}]\` \`${f.file}:${f.line}\` -- ${f.description}`;

// AFTER: Confidence only for medium/low
const confLabel = f.confidence === 'high' ? '' : ` \`[${f.confidence}]\``;
body += `\n- **${severity}**${confLabel} \`${f.file}:${f.line}\` -- ${f.description}`;
```

### Current printFindings Pattern (output.ts:225-248)
```typescript
// AFTER: Add confidence label for medium/low in terminal output
// For non-nitpick findings:
const confLabel = f.confidence !== 'high' ? pc.dim(` [${f.confidence}]`) : '';
console.log(`  ${icon}${confLabel} ${pc.dim(location)} ${headline}`);

// For nitpick findings (already fully dimmed):
const confLabel = f.confidence !== 'high' ? ` [${f.confidence}]` : '';
console.log(pc.dim(`  \u25CB nitpick${confLabel} ${location} ${headline}`));
```

### Current handlePostAnalysis Debug Line (cli.ts:54-63)
```typescript
// BEFORE
printDebug(`Findings: ${findings.length} raw, ${posted} posted`);

// AFTER (with dedup stats)
printDebug(`Findings: ${rawCount} raw, ${removedCount} duplicates removed, ${posted} posted`);
```

### HTML Report Annotation Rendering (html-report.ts:86-92)
```typescript
// AFTER: Add confidence badge for medium/low
function renderAnnotation(finding: ReviewFinding): string {
  const borderClass = `annotation-${finding.severity === 'bug' || finding.severity === 'security' ? 'critical' : finding.severity === 'suggestion' ? 'suggestion' : 'nitpick'}`;
  const confBadge = finding.confidence !== 'high'
    ? ` <span class="confidence-badge">${escapeHtml(finding.confidence)}</span>`
    : '';
  return `<div class="annotation ${borderClass}">
  <div class="annotation-header">${renderSeverityBadge(finding.severity)}${confBadge} <span class="annotation-category">${escapeHtml(finding.category)}</span></div>
  <div class="annotation-body">${escapeHtml(finding.description)}</div>
</div>`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Always show confidence on every finding | Show confidence only when it adds information (medium/low) | This phase | Cleaner output; absence of label implies high confidence |
| Pass raw Claude output directly to all surfaces | Filter duplicates at pipeline choke point | This phase | Fewer redundant findings across all output types |

**Deprecated/outdated:**
- None applicable. This phase adds new behavior to an existing pipeline.

## Open Questions

1. **Should the dedup ranking maps be shared with output.ts or duplicated?**
   - What we know: `SEVERITY_ORDER` and `CONFIDENCE_ORDER` exist in `output.ts` but are module-private (not exported). The dedup function needs the same ranking.
   - What's unclear: Whether to export from `output.ts` or duplicate in `dedup.ts`.
   - Recommendation: Duplicate in `dedup.ts`. The maps are 6 lines total, and coupling dedup to output.ts for DRY creates an unnecessary dependency. If a future refactor centralizes them, that's fine, but for now independence is better.

2. **Exact confidence label format for terminal output**
   - What we know: This is Claude's discretion. GitHub markdown format should use `` `[medium]` `` (backtick-wrapped) to match existing style. Terminal should use dimmed text.
   - What's unclear: Whether to use `[medium]` or `(medium confidence)` or `medium` in terminal.
   - Recommendation: Use `[medium]` or `[low]` in dimmed text for terminal (compact, consistent with GitHub format). For HTML, use a small badge similar to severity badges but styled more subtly (e.g., lighter background).

3. **Should the verbose "duplicates removed" count be omitted when zero?**
   - What we know: The context says "extend the existing debug line to include dedup count." When there are zero duplicates removed, showing "0 duplicates removed" is technically accurate but adds noise.
   - What's unclear: Whether to always include or conditionally include.
   - Recommendation: Always include when verbose is on. "0 duplicates removed" confirms the dedup ran and is useful for debugging. The verbose flag is already opt-in for users who want details.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/dedup.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FILT-01 | Findings at same file+line+category deduplicated to highest severity | unit | `npx vitest run tests/dedup.test.ts -x` | Wave 0 |
| FILT-01 | Same-severity tiebreaker uses confidence, then encounter order | unit | `npx vitest run tests/dedup.test.ts -x` | Wave 0 |
| FILT-01 | Bug/security findings still deduplicated (not exempt from dedup) | unit | `npx vitest run tests/dedup.test.ts -x` | Wave 0 |
| FILT-01 | Verbose mode shows dedup stats in debug line | unit | `npx vitest run tests/output.test.ts -x` | Extend existing |
| FILT-01 | Dedup applied before all output surfaces (terminal, GitHub, HTML) | integration | `npx vitest run tests/output.test.ts -x` | Extend existing |
| FILT-02 | High confidence findings show no confidence label (terminal) | unit | `npx vitest run tests/output.test.ts -x` | Extend existing |
| FILT-02 | Medium/low confidence findings show confidence label (terminal) | unit | `npx vitest run tests/output.test.ts -x` | Extend existing |
| FILT-02 | High confidence findings show no confidence label (GitHub inline) | unit | `npx vitest run tests/formatter.test.ts -x` | Wave 0 |
| FILT-02 | Medium/low confidence findings show label (GitHub inline) | unit | `npx vitest run tests/formatter.test.ts -x` | Wave 0 |
| FILT-02 | High confidence findings show no confidence label (off-diff body) | unit | `npx vitest run tests/review-builder.test.ts -x` | Wave 0 |
| FILT-02 | Medium/low confidence findings show label (off-diff body) | unit | `npx vitest run tests/review-builder.test.ts -x` | Wave 0 |
| FILT-02 | High confidence findings show no confidence label (HTML report) | unit | `npx vitest run tests/html-report.test.ts -x` | Extend existing |
| FILT-02 | Medium/low confidence findings show label (HTML report) | unit | `npx vitest run tests/html-report.test.ts -x` | Extend existing |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/dedup.test.ts tests/output.test.ts tests/formatter.test.ts tests/review-builder.test.ts tests/html-report.test.ts -x`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/dedup.test.ts` -- covers FILT-01 dedup logic (new file)
- [ ] `tests/formatter.test.ts` -- covers FILT-02 inline comment confidence (new file; no existing tests for formatter.ts)
- [ ] `tests/review-builder.test.ts` -- covers FILT-02 off-diff body confidence (new file; no existing tests for review-builder.ts)
- [ ] Extend `tests/output.test.ts` -- covers FILT-02 terminal confidence labels
- [ ] Extend `tests/html-report.test.ts` -- covers FILT-02 HTML confidence labels

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/cli.ts`, `src/output.ts`, `src/formatter.ts`, `src/review-builder.ts`, `src/schemas.ts`, `src/types.ts`, `src/html-report.ts` -- all integration points verified by reading source
- Codebase inspection: `tests/output.test.ts`, `tests/html-report.test.ts` -- existing test patterns confirmed
- `package.json` -- confirmed Vitest 4.0.x, no new dependencies needed
- `vitest.config.ts` -- confirmed test configuration
- `tsconfig.json` -- confirmed TypeScript strict mode, ES2022 target

### Secondary (MEDIUM confidence)
- None needed. This phase is entirely internal to the codebase.

### Tertiary (LOW confidence)
- None. No external research required.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries; all tools already in the project
- Architecture: HIGH -- all integration points verified by reading the actual source code
- Pitfalls: HIGH -- identified from direct code inspection; common array/string manipulation issues

**Research date:** 2026-03-04
**Valid until:** Indefinite (codebase-specific patterns, no external dependency versioning concerns)

# Phase 04: Context-Aware Review Pipeline - Research

**Researched:** 2026-03-04
**Domain:** PR intent extraction, convention detection prompting, end-to-end pipeline integration
**Confidence:** HIGH

## Summary

Phase 4 is the integration phase that wires together Phases 1-3 and adds two new capabilities: (1) PR intent extraction from title/description to calibrate which findings get flagged, and (2) a convention scan instruction block in the deep-mode agentic prompt that directs Claude to read 2-3 sibling files before reviewing. Unlike Phases 1-3 which were self-contained additions, this phase modifies the pipeline orchestration in `cli.ts` and prompt construction in `prompt.ts` to thread intent data through the full flow.

The implementation is straightforward because the codebase already has every structural pattern needed. `ReviewContext` (types.ts) is the established data contract -- extend it with an `intent` field. The prompt functions accept `ReviewContext` as an optional parameter. The shared constant pattern (`FINDING_FORMAT_INSTRUCTIONS`, `SEVERITY_EXAMPLES`) provides the template for new prompt sections. The pipeline in `cli.ts` already follows fetch -> context -> prompt -> analyze -> dedup -> output ordering. No new dependencies, no new files, no new CLI flags.

The primary risk is prompt quality, not code complexity. Intent-based flagging adjustments must not suppress real bugs (a bug is a bug regardless of PR intent). Convention scan instructions must be specific enough that Claude reads the right files but not so prescriptive that they waste agentic turns. Both capabilities are testable through unit tests on prompt content and the existing eval fixture suite for regression detection.

**Primary recommendation:** Add `extractIntent()` function to prompt.ts (or a new intent.ts), extend `ReviewContext` with an `intent` field, add intent-based flagging guidance and convention scan instructions to prompt construction, wire intent extraction into cli.ts between fetchPRData and prompt building, and add verbose output for intent. Test with prompt.test.ts assertions and full eval suite regression check.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Derive intent from PR title and description only (already in PRData) -- no diff signal analysis
- Recognize core categories: feature, bugfix, refactor, dependency update, docs/config
- Intent extraction works in both quick and deep modes (no extra API calls needed)
- Intent guides what gets flagged, NOT severity labels -- a refactor PR skips "add tests for new behavior" since there IS no new behavior, but a real bug is still severity "bug"
- Structural patterns only for convention detection: naming conventions, error handling patterns, import organization, module structure
- No style detection (indentation, semicolons, quotes) -- that overlaps with linters
- Prompt-guided scan: add a "Convention Scan" instruction section to the agentic prompt, Claude reads 2-3 sibling files before reviewing
- Deep mode only for convention detection -- quick mode gets no convention awareness (requires repo access)
- Convention findings must reference the detected pattern explicitly with file:line evidence
- PR intent shown in --verbose mode only: `[debug] Intent: refactor (from title)` -- follows existing verbose pattern
- No separate "conventions detected" output -- conventions appear naturally in finding descriptions where they matter
- No changes to HTML report format -- better findings automatically mean better reports
- Keep MAX_AGENTIC_TURNS at 75 -- convention scanning is prompt-guided (2-3 file reads), not a multi-turn phase
- End-to-end order: fetch PR data -> gather context (Phase 2) -> build prompt with intent + conventions (Phase 4) + severity examples (Phase 3) -> analyze -> deduplicate findings (Phase 1) -> output
- Extend ReviewContext type with intent field for both modes
- Convention scan instructions added to agentic prompt only (deep mode)

### Claude's Discretion
- Exact intent category detection logic (keyword matching, heuristic rules, or freeform classification)
- Specific convention scan prompt wording and instruction placement in agentic prompt
- How many sibling files to suggest reading for convention detection (guideline: 2-3)
- How intent categories map to specific flagging adjustments in prompt text
- Whether to add intent as a prompt section or weave it into existing reviewer instructions

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROMPT-02 | Review derives PR intent from title/description and calibrates finding severity against that goal | New `extractIntent()` function parses PRData.title + PRData.body into intent category; intent-specific flagging guidance injected into both `buildPrompt()` and `buildAgenticPrompt()` via shared constant or inline section; ReviewContext extended with `intent` field |
| PROMPT-04 | Deep mode performs a convention scan phase before reviewing -- reads 2-3 representative files near changed files to identify naming, error handling, and structural patterns | New "Convention Scan" instruction section in `buildAgenticPrompt()` placed before the review instructions; directs Claude to read 2-3 sibling files in the same directories as changed files and identify structural patterns before producing findings |
</phase_requirements>

## Standard Stack

No new libraries needed. This phase is pure logic + prompt content authoring within existing code.

### Core (Existing, Unchanged)
| Library | Version | Purpose | Role in This Phase |
|---------|---------|---------|-------------------|
| typescript | strict mode | Type checking | `npm run lint` validates all edits |
| vitest | 4.0.18 | Test runner | `npm test` runs prompt.test.ts, context.test.ts, eval.test.ts |

### Installation
```bash
# No new packages needed
```

## Architecture Patterns

### Files to Modify
```
src/
  types.ts            # MODIFIED: Add intent field to ReviewContext
  prompt.ts           # MODIFIED: Add intent extraction, intent flagging guidance, convention scan instructions
  cli.ts              # MODIFIED: Wire intent extraction between fetchPRData and prompt building, add verbose output
tests/
  prompt.test.ts      # MODIFIED: Add assertions for intent extraction, intent guidance, convention scan
```

Note: No new files. The intent extraction function belongs in `prompt.ts` because it produces prompt-level guidance (not a separate data-fetching concern like context.ts). Alternatively it could be a separate `intent.ts` module for cleaner separation -- this is a discretion item.

### Pattern 1: Intent Extraction via Keyword Matching
**What:** A pure function that takes PR title and body, applies keyword/pattern heuristics, and returns a string intent category.
**When to use:** Called once per review, before prompt construction.
**Recommended approach:** Keyword matching on title (primary signal) with body as fallback context. Title is the strongest signal because PR authors typically write descriptive titles ("fix: ...", "refactor: ...", "chore: bump ...").

```typescript
// Intent categories per user decision
type PRIntent = 'feature' | 'bugfix' | 'refactor' | 'dependency' | 'docs-config' | 'unknown';

function extractIntent(title: string, body: string): PRIntent {
  const combined = `${title}\n${body}`.toLowerCase();

  // Conventional commits and common patterns
  // Check title first (stronger signal), then combined
  const t = title.toLowerCase();

  // Bugfix signals
  if (/\bfix(?:es|ed)?\b|\bbug\b|\bhotfix\b|\bpatch\b/.test(t)) return 'bugfix';
  if (/^fix[:(\/]/.test(t)) return 'bugfix';

  // Refactor signals
  if (/\brefactor\b|\bcleanup\b|\brestructure\b|\breorganize\b/.test(t)) return 'refactor';
  if (/^refactor[:(\/]/.test(t)) return 'refactor';

  // Dependency update signals
  if (/\bbump\b|\bdep(?:endenc(?:y|ies))?\b|\bupgrade\b|\bupdate\b.*(?:version|package|dep)/.test(t)) return 'dependency';
  if (/^chore[:(\/].*(?:dep|bump|upgrade|version)/.test(t)) return 'dependency';

  // Docs/config signals
  if (/\bdocs?\b|\bdocument(?:ation)?\b|\breadme\b|\bconfig\b|\bci\b|\b\.yml\b|\b\.yaml\b/.test(t)) return 'docs-config';
  if (/^(?:docs|chore)[:(\/]/.test(t)) return 'docs-config';

  // Feature signals (check last -- broadest category)
  if (/\bfeat(?:ure)?\b|\badd\b|\bimplement\b|\bintroduce\b|\bnew\b/.test(t)) return 'feature';
  if (/^feat[:(\/]/.test(t)) return 'feature';

  // Body fallback for ambiguous titles
  if (/\bfix(?:es|ed)?\b.*\bbug\b/.test(combined)) return 'bugfix';
  if (/\brefactor/.test(combined)) return 'refactor';

  return 'unknown';
}
```

**Confidence:** HIGH -- keyword matching on PR titles is a well-established heuristic. Conventional commit prefixes (`fix:`, `feat:`, `refactor:`) are widely adopted. The fallback to 'unknown' is safe -- unknown intent means no flagging adjustments (reviewer behaves as before).

### Pattern 2: Intent-Based Flagging Guidance in Prompts
**What:** A mapping from intent category to specific prompt paragraphs that tell the reviewer what to focus on and what to skip.
**When to use:** Injected into both `buildPrompt()` and `buildAgenticPrompt()` after the base reviewer persona but before the diff.
**Key principle from user decision:** Intent guides what gets flagged, NOT severity labels. A real bug is always severity "bug" regardless of intent. Intent adjusts the reviewer's focus.

```typescript
// Mapping intent to flagging adjustments
function getIntentGuidance(intent: PRIntent): string {
  switch (intent) {
    case 'bugfix':
      return `\n\nPR INTENT -- BUG FIX: This PR fixes a bug. Focus on whether the fix is correct and complete. Check edge cases the fix might miss. Verify the fix does not introduce regressions. Do NOT suggest unrelated refactoring or new features in the affected code.`;

    case 'refactor':
      return `\n\nPR INTENT -- REFACTOR: This PR restructures existing code without changing behavior. Focus on whether the refactoring preserves existing behavior (no accidental behavior changes). Check for broken callers or changed contracts. Do NOT flag "add tests for new behavior" since there is no new behavior -- only flag if existing test coverage was removed or broken by the restructuring.`;

    case 'feature':
      return `\n\nPR INTENT -- NEW FEATURE: This PR adds new functionality. Focus on correctness of the new code, edge case handling, error handling, and whether the feature integrates cleanly with existing code. Check for adequate test coverage of the new behavior.`;

    case 'dependency':
      return `\n\nPR INTENT -- DEPENDENCY UPDATE: This PR updates dependencies. Focus on breaking changes from the updated packages, deprecated API usage, and version compatibility. Do NOT flag code style or structure in lockfiles or auto-generated dependency metadata.`;

    case 'docs-config':
      return `\n\nPR INTENT -- DOCS/CONFIG: This PR updates documentation or configuration. Focus on accuracy of documentation, correctness of configuration values, and whether config changes could affect runtime behavior. Do NOT flag minor prose style preferences.`;

    case 'unknown':
    default:
      return ''; // No adjustment -- reviewer behaves as normal
  }
}
```

**Insertion point:** After `<pr_metadata>` and before `<diff>` in both prompt functions. This positions intent guidance right after the PR context, so the reviewer knows the PR's purpose before seeing the code.

### Pattern 3: Convention Scan Instructions for Deep Mode
**What:** A new instruction section in `buildAgenticPrompt()` that tells Claude to read 2-3 sibling files in the same directories as changed files before producing findings.
**When to use:** Deep mode only (requires repo access). Placed before the "Review Instructions" section so Claude scans conventions first.
**Key principle from user decision:** Convention findings must reference the detected pattern explicitly with file:line evidence.

```typescript
// Build convention scan section for deep mode prompt
function buildConventionScanInstructions(changedFiles: PRFile[]): string {
  // Collect unique directories from changed files
  const dirs = [...new Set(changedFiles.map(f => {
    const parts = f.filename.split('/');
    parts.pop(); // remove filename
    return parts.join('/') || '.';
  }))];

  const dirList = dirs.map(d => `- \`${d}/\``).join('\n');

  return `## Convention Scan

Before reviewing the diff, read 2-3 existing files in or near the directories containing the changed files to understand the codebase's conventions:

${dirList}

Identify structural patterns in these files:
- **Naming conventions**: How are functions, classes, constants, and files named?
- **Error handling patterns**: Does the codebase use custom error classes, error codes, or raw throws?
- **Import organization**: Are imports grouped (external first, then internal)? Are there barrel files?
- **Module structure**: How are exports organized? Are there consistent patterns for default vs named exports?

Do NOT look for style conventions (indentation, semicolons, quotes) -- those are the linter's job.

When you find a convention violation in the PR changes, your finding description MUST reference the established pattern with specific file:line evidence. For example: "This module uses throw new AppError(...) for error handling (see auth.ts:45, db.ts:32), but this function uses raw throw."

Now proceed to the review.`;
}
```

**Placement in buildAgenticPrompt:** After security constraints, before the diff. This ensures Claude reads sibling files first (it's an agentic session with file access), identifies conventions, then applies that knowledge when reviewing the diff.

### Pattern 4: Extending ReviewContext with Intent
**What:** Add an optional `intent` field to the existing `ReviewContext` interface.
**When to use:** Populated in cli.ts after extracting intent, threaded through to prompt construction.

```typescript
// In types.ts -- extend existing ReviewContext
export interface ReviewContext {
  relatedFiles?: RelatedFile[];
  explorationGuidance?: ExplorationCategory[];
  intent?: string;  // NEW: PR intent category (feature, bugfix, refactor, etc.)
}
```

**Backward compatibility:** The field is optional, matching the Phase 2 decision to thread ReviewContext as optional last parameter.

### Pattern 5: Pipeline Integration in cli.ts
**What:** Insert intent extraction between fetchPRData and prompt construction.
**Pipeline order:** fetch PR data -> extract intent -> gather context (Phase 2) -> build prompt with intent + conventions -> analyze -> deduplicate -> output

```typescript
// In cli.ts action handler, after fetchPRData:
import { extractIntent } from './prompt.js';

// Extract PR intent (works for both quick and deep modes)
const intent = extractIntent(prData.title, prData.body ?? '');
if (options.verbose) {
  const source = intent !== 'unknown' ? 'from title' : 'not detected';
  printDebug(`Intent: ${intent} (${source})`);
}

// Thread intent into context for both modes
// When building quickContext or deepContext:
if (quickContext) {
  quickContext.intent = intent;
} else {
  quickContext = { intent };
}
```

### Anti-Patterns to Avoid
- **Intent changing severity labels:** User explicitly decided intent guides flagging focus, NOT severity. A bug found during a refactor PR is still severity "bug". Never downgrade severity based on intent.
- **Convention scan consuming many agentic turns:** The instruction says "read 2-3 files" -- it should be a quick scan, not a deep exploration. MAX_AGENTIC_TURNS stays at 75.
- **Detecting style conventions:** User explicitly excluded indentation, semicolons, quotes. Only structural patterns (naming, error handling, imports, module structure).
- **Breaking existing prompt tests:** The prompt.test.ts file has 54 tests. All additions must be additive -- never remove or rephrase existing prompt text.
- **Adding intent to HTML report or non-verbose terminal output:** User decided intent is verbose-only. No changes to HTML report format.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Intent classification | ML classifier or LLM pre-call | Keyword matching on title/body | PR titles are highly conventional; keyword matching covers 90%+ of cases. No need for an API call when heuristics work well. |
| Convention detection | Static analysis tool | Prompt-guided Claude scan | Claude is already running in agentic mode with repo access. Prompt instructions direct it to read sibling files -- zero code complexity. |
| PR metadata parsing | Custom title parser | Simple regex on title string | Conventional commits and common PR title patterns are well-defined; regex is sufficient. |

**Key insight:** Both new capabilities (intent extraction and convention scanning) are deliberately lightweight. Intent is keyword matching, conventions are prompt instructions. The heavy lifting is done by Claude's existing capabilities during the review session.

## Common Pitfalls

### Pitfall 1: Intent Extraction Misclassifying Mixed-Intent PRs
**What goes wrong:** A PR titled "fix bug and add feature for X" matches both bugfix and feature patterns. The first match wins, potentially mislabeling.
**Why it happens:** Keyword matching is greedy and order-dependent.
**How to avoid:** Define a clear priority order (bugfix > refactor > feature > dependency > docs-config). When in doubt, the most conservative classification wins. 'unknown' is always a safe fallback -- it means no flagging adjustments.
**Warning signs:** Test cases with compound titles producing unexpected classifications.

### Pitfall 2: Convention Scan Instructions Being Too Vague
**What goes wrong:** Claude doesn't know which files to read for convention scanning, wastes turns exploring irrectories, or reads irrelevant files.
**Why it happens:** Generic "read some files nearby" lacks specificity.
**How to avoid:** Explicitly list the directories containing changed files in the convention scan instruction. Say "read 2-3 existing files in `src/lib/`" rather than "read some files near the changed code." Limit to structural patterns only.
**Warning signs:** Deep mode reviews taking significantly more turns after adding convention scan, or convention scan not producing useful convention references in findings.

### Pitfall 3: Intent Guidance Suppressing Legitimate Findings
**What goes wrong:** A refactor PR's guidance says "don't suggest new features" but the reviewer interprets a legitimate bug fix as a "new feature suggestion" and suppresses it.
**Why it happens:** Vague guidance about what to skip.
**How to avoid:** Intent guidance must explicitly say "bugs and security issues are ALWAYS reported regardless of intent." Only skip-guidance should be for clearly intent-inappropriate findings (e.g., "add tests for new behavior" on a refactor that adds no new behavior).
**Warning signs:** Eval suite regression -- fewer bugs found after adding intent guidance.

### Pitfall 4: Breaking Existing Prompt Test Assertions
**What goes wrong:** Adding new sections to `buildPrompt()` or `buildAgenticPrompt()` changes the string content in ways that break ordering or content assertions.
**Why it happens:** Tests assert on content presence and relative ordering (e.g., "mode overlay appears after JSON instruction").
**How to avoid:** Run `npx vitest run tests/prompt.test.ts` after every prompt edit. New content should be additive -- insert between existing sections without moving or rephrasing existing text. Check ordering assertions carefully.
**Warning signs:** prompt.test.ts failures on "appends overlay after base prompt" or "places related files after </diff>".

### Pitfall 5: Intent Field Not Threaded Through All Code Paths
**What goes wrong:** Intent is extracted but not passed to the prompt function in one of the code paths (quick mode, deep mode, fallback-to-quick-from-deep).
**Why it happens:** cli.ts has three distinct code paths for prompt construction: quick mode (line 316), deep mode (line 264 via buildAgenticPrompt), and deep-fallback-to-quick (line 249).
**How to avoid:** Use ReviewContext as the single carrier for intent. Build the context object with intent before branching into mode-specific paths. All three paths already accept ReviewContext.
**Warning signs:** Intent verbose output appears but findings don't reflect intent guidance.

### Pitfall 6: Convention Scan Instruction Placement Conflicting with Exploration Section
**What goes wrong:** Both "Convention Scan" and "Codebase Exploration" tell Claude to read files before reviewing, creating confusion about which comes first.
**Why it happens:** The convention scan reads files for pattern detection; the exploration section reads files for cross-file issue detection. These are different purposes but similar actions.
**How to avoid:** Convention scan section should come before the diff and review instructions. It says "scan these files for conventions, then proceed to the review." The exploration section comes after the review instructions and says "explore the codebase for cross-file issues." The ordering makes the flow clear: convention scan -> diff review -> codebase exploration.
**Warning signs:** Claude confusing convention scanning with cross-file issue exploration in its output.

## Code Examples

### Intent Extraction Integration in cli.ts
```typescript
// After fetchPRData and printPRSummary, before mode branching:
const intent = extractIntent(prData.title, prData.body ?? '');
if (options.verbose) {
  const source = intent !== 'unknown' ? 'from title' : 'not detected';
  printDebug(`Intent: ${intent} (${source})`);
}
```

### ReviewContext Extension in types.ts
```typescript
export interface ReviewContext {
  relatedFiles?: RelatedFile[];
  explorationGuidance?: ExplorationCategory[];
  intent?: string;  // PR intent category
}
```

### Intent Guidance Injection in buildPrompt
```typescript
// In buildPrompt(), after pr_metadata block, before diff:
const intentGuidance = context?.intent ? getIntentGuidance(context.intent) : '';

// In template:
`...
</pr_metadata>
${intentGuidance}
<diff>
...`
```

### Convention Scan in buildAgenticPrompt
```typescript
// In buildAgenticPrompt(), after security constraints, before diff:
const conventionScanSection = buildConventionScanInstructions(prData.files);

// In template:
`...
${conventionScanSection}

<pr_metadata>
...`
```

### Test Assertions for Intent Extraction
```typescript
describe('extractIntent', () => {
  it('detects bugfix from conventional commit prefix', () => {
    expect(extractIntent('fix: null pointer in auth flow', '')).toBe('bugfix');
  });

  it('detects refactor from title keyword', () => {
    expect(extractIntent('Refactor user service', '')).toBe('refactor');
  });

  it('detects feature from feat prefix', () => {
    expect(extractIntent('feat: add dark mode support', '')).toBe('feature');
  });

  it('detects dependency update from bump keyword', () => {
    expect(extractIntent('Bump @octokit/rest from 21 to 22', '')).toBe('dependency');
  });

  it('returns unknown for ambiguous title', () => {
    expect(extractIntent('Update code', '')).toBe('unknown');
  });

  it('never returns empty string', () => {
    expect(extractIntent('', '')).toBe('unknown');
  });
});

describe('buildPrompt with intent', () => {
  it('includes intent guidance when intent is provided', () => {
    const context: ReviewContext = { intent: 'refactor' };
    const prompt = buildPrompt(mockPR, 'balanced', context);
    expect(prompt).toContain('REFACTOR');
  });

  it('no intent guidance when intent is unknown', () => {
    const context: ReviewContext = { intent: 'unknown' };
    const prompt = buildPrompt(mockPR, 'balanced', context);
    expect(prompt).not.toContain('PR INTENT');
  });
});

describe('buildAgenticPrompt convention scan', () => {
  it('contains Convention Scan section header', () => {
    const prompt = buildAgenticPrompt(mockPR, 'balanced');
    expect(prompt).toContain('## Convention Scan');
  });

  it('references changed file directories', () => {
    const prompt = buildAgenticPrompt(multiFilePR, 'balanced');
    expect(prompt).toContain('src/');
  });

  it('mentions naming conventions and error handling', () => {
    const prompt = buildAgenticPrompt(mockPR, 'balanced');
    expect(prompt).toMatch(/naming convention/i);
    expect(prompt).toMatch(/error handling/i);
  });

  it('explicitly excludes style conventions', () => {
    const prompt = buildAgenticPrompt(mockPR, 'balanced');
    expect(prompt).toMatch(/do not.*style|not.*indentation|linter/i);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Same review regardless of PR purpose | Intent-aware flagging guidance | This phase | Reduces noise (refactor PRs don't get "add tests for new behavior" suggestions) |
| No convention awareness in deep mode | Convention scan before review | This phase | Findings reference actual codebase patterns instead of generic best practices |
| Phase 1-3 features independent | Full pipeline integration | This phase | End-to-end flow: context -> intent -> prompts -> analysis -> dedup -> output |

## Open Questions

1. **Where to place extractIntent function**
   - What we know: Could go in prompt.ts (it produces prompt guidance) or a new intent.ts module
   - Recommendation: Place in prompt.ts. It's a small function (20-30 lines) that directly serves prompt construction. A separate module adds file overhead for minimal benefit. If the function grows later, it can be extracted.

2. **Convention scan section placement in agentic prompt**
   - What we know: Must come before the diff review so Claude scans first. Could go before `<pr_metadata>` (very early) or between metadata and diff.
   - Recommendation: Place after security constraints and before `<pr_metadata>`. This way Claude sees: security rules -> convention scan instruction -> PR info -> diff -> review instructions -> exploration. The convention scan is logically "preparation before reviewing."

3. **Intent extraction from body vs title weighting**
   - What we know: Titles are more reliable (short, structured, often use conventional commit format). Bodies are longer, noisier, may contain templates.
   - Recommendation: Match on title first. Only fall back to body if title produces 'unknown'. Body patterns should be more restrictive (require stronger signals) to avoid false positives from PR templates that mention "fix", "feature", etc. in boilerplate.

4. **How intent interacts with mode overlays**
   - What we know: Mode overlays (strict, balanced, lenient) and intent guidance both modify reviewer behavior. They could conflict.
   - Recommendation: Intent guidance is additive to mode overlays, not a replacement. Intent says "this is a refactor, skip X" while mode says "be strict/lenient about Y." Both apply independently. Intent guidance is inserted before the diff; mode overlay is appended at the end (existing position). No conflict because they operate on different dimensions (PR purpose vs. review thoroughness).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | vitest via package.json |
| Quick run command | `npx vitest run tests/prompt.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROMPT-02 | extractIntent returns correct categories for common PR title patterns | unit | `npx vitest run tests/prompt.test.ts -t "extractIntent"` | Needs new test describe block |
| PROMPT-02 | Intent guidance appears in buildPrompt output when intent is non-unknown | unit | `npx vitest run tests/prompt.test.ts -t "intent"` | Needs new assertions |
| PROMPT-02 | Intent guidance appears in buildAgenticPrompt output when intent is non-unknown | unit | `npx vitest run tests/prompt.test.ts -t "intent"` | Needs new assertions |
| PROMPT-02 | No intent guidance when intent is 'unknown' (no-op fallback) | unit | `npx vitest run tests/prompt.test.ts -t "unknown"` | Needs new assertion |
| PROMPT-02 | ReviewContext.intent field accepted by prompt functions | unit | `npx vitest run tests/prompt.test.ts -t "intent"` | Needs new assertions |
| PROMPT-04 | Convention Scan section present in buildAgenticPrompt output | unit | `npx vitest run tests/prompt.test.ts -t "convention"` | Needs new assertions |
| PROMPT-04 | Convention scan mentions naming, error handling, import patterns | unit | `npx vitest run tests/prompt.test.ts -t "convention"` | Needs new assertions |
| PROMPT-04 | Convention scan NOT present in buildPrompt (quick mode) | unit | `npx vitest run tests/prompt.test.ts -t "convention"` | Needs new assertion |
| PROMPT-04 | Convention scan references directories from changed files | unit | `npx vitest run tests/prompt.test.ts -t "convention"` | Needs new assertions |
| ALL | Eval fixture suite shows no regression | integration | `npx vitest run tests/eval.test.ts` | Exists (25 tests) |
| ALL | Full test suite (304 tests) passes | integration | `npm test` | Exists |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/prompt.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test describe block `extractIntent` in `tests/prompt.test.ts` -- covers PROMPT-02 intent extraction
- [ ] New test describe block for intent guidance in prompts in `tests/prompt.test.ts` -- covers PROMPT-02 prompt integration
- [ ] New test describe block for convention scan in `tests/prompt.test.ts` -- covers PROMPT-04

*(Existing test infrastructure covers all other needs -- no new test files, frameworks, or fixtures required)*

## Sources

### Primary (HIGH confidence)
- `src/prompt.ts` -- direct code inspection of existing prompt construction, shared constants, mode overlays, insertion points
- `src/types.ts` -- ReviewContext interface structure, PRData fields available for intent extraction
- `src/cli.ts` -- full pipeline orchestration, three code paths (quick, deep, fallback), ReviewContext threading
- `src/context.ts` -- existing context gathering patterns, buildExplorationGuidance function
- `src/analyzer.ts` -- how prompts are passed to Claude CLI, MAX_AGENTIC_TURNS constant
- `tests/prompt.test.ts` -- 54 existing test assertions that must continue to pass
- `tests/eval.test.ts` -- 25 eval fixture tests for regression detection

### Secondary (MEDIUM confidence)
- CONTEXT.md user decisions -- locked implementation choices for intent categories, convention detection scope, pipeline ordering
- Phase 2 and Phase 3 research/plans -- established patterns for ReviewContext extension, shared constants, prompt modification

### Tertiary (LOW confidence)
- None -- all findings based on direct codebase inspection and user decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure logic and prompt content in existing modules
- Architecture: HIGH -- follows every established pattern: shared constants, ReviewContext threading, verbose debug output, additive prompt modification
- Pitfalls: HIGH -- identified from direct code inspection of three code paths in cli.ts, 54 prompt tests, and prompt ordering constraints
- Intent extraction: MEDIUM -- keyword matching is effective but edge cases exist (compound titles, unconventional naming). The 'unknown' fallback makes this safe.

**Research date:** 2026-03-04
**Valid until:** indefinite (prompt engineering patterns and keyword matching, not library versions)

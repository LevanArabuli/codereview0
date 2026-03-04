# Architecture Research

**Domain:** AI-powered CLI code review tool (quality improvement milestone)
**Researched:** 2026-03-04
**Confidence:** HIGH

---

## Current Pipeline (Baseline)

The existing architecture is a flat sequential pipeline. Understanding each stage is prerequisite to placing new components correctly.

```
cli.ts (orchestrator)
    │
    ├─[1] checkPrerequisites()          prerequisites.ts
    ├─[2] parsePRUrl()                  url-parser.ts
    ├─[3] fetchPRData()                 github.ts  →  PRData
    │
    ├─── QUICK MODE ──────────────────────────────────────────────
    │   ├─[4q] buildPrompt(prData)      prompt.ts  →  string
    │   └─[5q] analyzeDiff(prData)      analyzer.ts → ReviewFinding[]
    │
    └─── DEEP MODE ───────────────────────────────────────────────
        ├─[4d] cloneRepo()              cloner.ts
        └─[5d] analyzeAgentic(prData,   analyzer.ts → ReviewFinding[]
                               clonePath)
                    │
                    └── buildAgenticPrompt(prData)  prompt.ts → string
                        [Claude explores clonePath autonomously]

    [6] handlePostAnalysis(findings)
        ├── printFindings()             output.ts
        ├── generateHtmlReport()        html-report.ts
        └── postReview()                github.ts
```

**Key structural observation:** Both modes converge at step [6]. All quality improvements must produce `ReviewFinding[]` — the shared data contract. The `ReviewFinding` schema (schemas.ts) is the central integration point.

---

## System Overview After Quality Improvements

The improved architecture inserts a **context layer** between data fetching and prompt construction, and applies **post-analysis filtering** between Claude's output and the display/post layer.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI Layer (cli.ts)                        │
│  Orchestrates flow, handles errors, routes quick/deep modes      │
└──────────────────────┬──────────────────────────────────────────┘
                       │ PRData
┌──────────────────────▼──────────────────────────────────────────┐
│                    Context Layer (NEW)                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              context-gatherer.ts  (NEW)                  │   │
│  │  Quick mode: analyzes diff, infers intent from PR meta   │   │
│  │  Deep mode:  reads cloned repo for convention patterns   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  Output: ReviewContext (intent, conventions, related files)      │
└──────────────────────┬──────────────────────────────────────────┘
                       │ PRData + ReviewContext
┌──────────────────────▼──────────────────────────────────────────┐
│                   Prompt Layer (prompt.ts — MODIFIED)            │
│  buildPrompt(prData, context?, mode)    quick mode               │
│  buildAgenticPrompt(prData, context?, mode)   deep mode          │
│  Injects context sections into prompt XML blocks                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │ string prompt
┌──────────────────────▼──────────────────────────────────────────┐
│                  Analysis Layer (analyzer.ts — UNCHANGED API)    │
│  analyzeDiff() / analyzeAgentic()                                │
│  Claude CLI subprocess — returns ReviewFinding[]                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │ ReviewFinding[] (raw)
┌──────────────────────▼──────────────────────────────────────────┐
│                   Filter Layer (NEW)                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              finding-filter.ts  (NEW)                    │   │
│  │  Drops low-confidence findings below mode threshold      │   │
│  │  Suppresses findings with no actionable specificity      │   │
│  └──────────────────────────────────────────────────────────┘   │
│  Output: ReviewFinding[] (filtered)                              │
└──────────────────────┬──────────────────────────────────────────┘
                       │ ReviewFinding[] (filtered)
┌──────────────────────▼──────────────────────────────────────────┐
│                   Output Layer (UNCHANGED API)                   │
│  output.ts / html-report.ts / github.ts                          │
│  Consume ReviewFinding[] — no changes needed                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### Existing Components (Role After Changes)

| Component | Current Role | Change Needed |
|-----------|-------------|---------------|
| `cli.ts` | Pipeline orchestrator | Call context-gatherer before prompt; call filter after analysis |
| `prompt.ts` | Builds prompts from PRData | Accept optional `ReviewContext`; inject context sections |
| `analyzer.ts` | Runs Claude subprocess | No API change — receives richer prompts transparently |
| `schemas.ts` | Zod validation schemas | No change needed — `confidence` field already exists |
| `github.ts` | API fetch + post | No change |
| `output.ts` | Terminal display | No change — already sorts by severity then confidence |
| `types.ts` | Shared types | Add `ReviewContext` type |

### New Components

| Component | Responsibility |
|-----------|---------------|
| `context-gatherer.ts` | Builds `ReviewContext` from PRData and optional clonePath |
| `finding-filter.ts` | Applies post-analysis filtering rules to `ReviewFinding[]` |

---

## New Type: ReviewContext

```typescript
// src/types.ts — new addition

/** Context gathered about the PR before prompt construction */
export interface ReviewContext {
  /** Inferred intent: what this PR is trying to accomplish */
  intent: string;

  /** Detected codebase conventions relevant to changed files */
  conventions: string[];

  /** Related files worth knowing about (callers, tests, siblings) */
  relatedFiles: string[];

  /** Whether context came from deep (clone) or shallow (diff-only) analysis */
  depth: 'shallow' | 'deep';
}
```

`ReviewContext` is intentionally a plain data object — no methods, no class. It flows from `context-gatherer.ts` → `prompt.ts` as a value. This keeps the pipeline testable and the data contract explicit.

---

## New Module: context-gatherer.ts

**Responsibility:** Derive structured context from available information before prompt construction. Two modes with different information availability.

**Quick mode inputs:** `PRData` only (diff, file list, title, description)

**Deep mode inputs:** `PRData` + `clonePath` (full codebase access via filesystem)

```typescript
// src/context-gatherer.ts

export async function gatherContext(
  prData: PRData,
  clonePath?: string,
): Promise<ReviewContext>
```

**Quick mode implementation (no new dependencies):**
- Parse PR title and description to extract intent keywords
- Classify change type from file extensions and diff patterns (e.g., "adds new API endpoint", "modifies authentication flow")
- Identify test files present in the diff
- Detect language/framework from file extensions

**Deep mode implementation (filesystem reads via Node `fs`):**
- Read `.editorconfig`, `eslint.config.*`, `tsconfig.json`, `package.json` for explicit conventions
- Scan 3-5 files adjacent to changed files for naming and structural patterns
- Identify test co-location pattern (are tests next to source, or in a `tests/` dir?)
- Detect error handling convention (checked exceptions, Result types, try/catch patterns)
- Cap filesystem reads at a budget (e.g., 20 files, 500 lines each) to avoid unbounded cost

**Security note:** Deep mode reads are filesystem-local (clonePath). No subprocess calls, no network calls. All reads use `fs.readFileSync` — maintains `execFile`-not-`exec` invariant by not using subprocesses for context gathering.

---

## New Module: finding-filter.ts

**Responsibility:** Apply post-analysis filtering to reduce noise before output/posting. Operates on `ReviewFinding[]` alone — does not need `PRData` or `ReviewContext`.

```typescript
// src/finding-filter.ts

export function filterFindings(
  findings: ReviewFinding[],
  mode: ReviewMode,
): ReviewFinding[]
```

**Filtering rules:**

| Rule | Rationale |
|------|-----------|
| Drop `confidence: 'low'` in `strict` and `lenient` modes | Low-confidence + already conservative mode = likely noise |
| Drop `confidence: 'low'` nitpicks in `balanced` mode | Low-confidence nitpicks are overwhelmingly false positives |
| Drop `confidence: 'low'` + `severity: 'nitpick'` in all modes | Combined signal is below actionability threshold |
| Keep all `severity: 'bug'` and `severity: 'security'` regardless | Never suppress high-severity findings on confidence alone |

**Design constraint:** Filter rules must be simple, deterministic, and testable. No LLM calls, no external dependencies. Pure function over the findings array.

---

## Modified Module: prompt.ts

**What changes:** Both `buildPrompt()` and `buildAgenticPrompt()` gain an optional `ReviewContext` parameter. When context is present, additional XML sections are injected into the prompt.

**API change (backward compatible):**

```typescript
// Before
export function buildPrompt(prData: PRData, mode?: ReviewMode): string

// After
export function buildPrompt(
  prData: PRData,
  mode?: ReviewMode,
  context?: ReviewContext,
): string
```

**New prompt sections injected when context is available:**

```
<pr_intent>
${context.intent}
</pr_intent>

<codebase_conventions>
${context.conventions.join('\n')}
</codebase_conventions>
```

For deep mode, `<related_files>` is also injected to guide Claude's exploration toward high-signal areas rather than random walking.

**Why prompt.ts not analyzer.ts:** The prompt layer is the correct abstraction boundary. The analyzer's job is subprocess invocation — it should not know about context. Context-to-prompt translation is prompt engineering, which belongs in prompt.ts.

---

## Data Flow: Enriched Quick Review

```
User: codereview https://github.com/org/repo/pull/123

[1] fetchPRData(octokit, ...)
    → PRData { title, body, diff, files, ... }

[2] gatherContext(prData)  ← NEW
    Reads: title, body, diff, file extensions
    → ReviewContext {
        intent: "Adds rate limiting to /api/auth endpoints",
        conventions: ["TypeScript strict mode", "Jest test files alongside source"],
        relatedFiles: [],
        depth: 'shallow'
      }

[3] buildPrompt(prData, mode, context)  ← MODIFIED
    Injects <pr_intent> and <codebase_conventions> sections
    → string (enriched prompt, ~15-25% larger)

[4] analyzeDiff(prData, model, mode)
    Internally: calls buildPrompt with context
    → ReviewFinding[] (raw, from Claude)

[5] filterFindings(findings, mode)  ← NEW
    → ReviewFinding[] (filtered)

[6] handlePostAnalysis(filteredFindings, ...)
    → terminal output, HTML report, GitHub review
```

---

## Data Flow: Enriched Deep Review

```
User: codereview --deep https://github.com/org/repo/pull/123

[1] fetchPRData(...)    → PRData

[2] cloneRepo(...)      → clonePath

[3] gatherContext(prData, clonePath)  ← NEW
    Reads: filesystem files, config files, adjacent source
    → ReviewContext {
        intent: "Adds rate limiting to /api/auth endpoints",
        conventions: [
          "Error handling: throws custom AppError subclasses",
          "Test files: co-located as *.test.ts",
          "Naming: camelCase functions, PascalCase classes",
          "Imports: barrel files in each feature directory"
        ],
        relatedFiles: ["src/middleware/auth.ts", "src/api/auth.test.ts"],
        depth: 'deep'
      }

[4] buildAgenticPrompt(prData, mode, context)  ← MODIFIED
    Injects <pr_intent>, <codebase_conventions>, <related_files>
    → string (enriched agentic prompt)

[5] analyzeAgentic(prData, clonePath, model, mode)
    Claude receives richer context upfront; explores clonePath
    → ReviewFinding[] (raw)

[6] filterFindings(findings, mode)  ← NEW
    → ReviewFinding[] (filtered)

[7] handlePostAnalysis(filteredFindings, ...)
```

---

## Architectural Patterns

### Pattern 1: Optional Context Injection

**What:** Context is an optional parameter to prompt builders. When absent, behavior is identical to today. When present, additional prompt sections are injected.

**When to use:** Features that enrich but don't require changes to the core analysis contract. Both modes benefit from the same pattern, just with different context depth.

**Trade-offs:** Pro: backward compatible, zero risk to existing behavior. Con: context quality varies (shallow vs. deep), which must be reflected in the prompts themselves.

```typescript
export function buildPrompt(
  prData: PRData,
  mode?: ReviewMode,
  context?: ReviewContext,
): string {
  let prompt = buildBasePrompt(prData);
  if (context) {
    prompt += buildContextSection(context);
  }
  prompt += getModeOverlay(mode ?? 'balanced');
  return prompt;
}
```

### Pattern 2: Post-Analysis Filter as Pure Function

**What:** `filterFindings()` is a pure function over `ReviewFinding[]`. No side effects, no external calls, deterministic output.

**When to use:** Any quality gate that can be expressed as a predicate over the findings array. This covers confidence thresholds, deduplication, and severity-based mode enforcement.

**Trade-offs:** Pro: trivially testable, zero risk of adding latency or failure modes. Con: can only use information already in the findings — cannot re-query Claude for clarification.

```typescript
export function filterFindings(
  findings: ReviewFinding[],
  mode: ReviewMode,
): ReviewFinding[] {
  return findings.filter(f => shouldKeep(f, mode));
}

function shouldKeep(f: ReviewFinding, mode: ReviewMode): boolean {
  // Never suppress bugs or security issues
  if (f.severity === 'bug' || f.severity === 'security') return true;
  // Drop low-confidence nitpicks in all modes
  if (f.severity === 'nitpick' && f.confidence === 'low') return false;
  // Mode-specific rules
  if (mode === 'strict' || mode === 'lenient') {
    return f.confidence !== 'low';
  }
  return true;
}
```

### Pattern 3: Context-Gathering Budget Caps

**What:** `gatherContext()` operates under explicit resource budgets: max files to read, max lines per file, max total characters of context emitted.

**When to use:** Any pre-analysis step that reads the filesystem or makes network calls. Without caps, large repos create unbounded latency and token cost growth.

**Trade-offs:** Pro: predictable performance regardless of repo size. Con: may miss conventions in deeply nested code. Accept this trade-off — the alternative (uncapped reads) is worse.

```typescript
const CONTEXT_LIMITS = {
  maxFilesRead: 20,
  maxLinesPerFile: 500,
  maxConventionsEmitted: 8,
  maxRelatedFiles: 10,
} as const;
```

---

## Anti-Patterns

### Anti-Pattern 1: Context in analyzer.ts

**What people do:** Add context-gathering logic inside `analyzeDiff()` or `analyzeAgentic()` for convenience.

**Why it's wrong:** The analyzer's responsibility is subprocess invocation and response parsing. Mixing context assembly into it creates an untestable blob and makes it impossible to test context logic independently of a Claude CLI call.

**Do this instead:** Keep `analyzer.ts` as a thin subprocess wrapper. Let `cli.ts` orchestrate context → prompt → analyze as three separate steps.

### Anti-Pattern 2: Subprocess for Convention Detection

**What people do:** Run `grep` or `git log` as a subprocess to find codebase patterns during context gathering.

**Why it's wrong:** Violates the `execFile`-not-`exec` security invariant, adds process startup overhead for each pattern, and introduces failure modes (grep not found, permissions). The deep mode already has the clonePath — all needed files are accessible via `fs.readFileSync`.

**Do this instead:** Read files directly with Node's `fs` APIs. Parse patterns in TypeScript. No subprocesses for context gathering.

### Anti-Pattern 3: Blocking on Full Convention Scan

**What people do:** Scan every file in the repo before starting the review, building a complete picture of conventions.

**Why it's wrong:** A 50k-file repo would block the review for minutes. Most conventions are detectable from 5-10 representative files.

**Do this instead:** Apply the budget cap pattern. Read files adjacent to changed paths first (highest relevance), stop when budget is reached, emit what was found.

### Anti-Pattern 4: Context That Exceeds Prompt Token Budget

**What people do:** Dump large amounts of context (hundreds of lines of conventions, 20+ related files) into the prompt.

**Why it's wrong:** Anthropic's research shows "more context isn't always better" — excessive irrelevant input increases false positives and model confusion. The existing diff is already up to 80KB. Context sections should be concise.

**Do this instead:** Cap `ReviewContext.conventions` at 8 items, `relatedFiles` at 10. Each convention should be one sentence. This keeps context additions to under 2KB in the prompt.

---

## Build Order (Dependency-Aware)

Features have dependencies on each other. This order respects those dependencies and allows each phase to be validated independently.

```
Phase 1 — Schema and Filter Foundation
    schemas.ts  →  (already has confidence field, no changes needed)
    finding-filter.ts  →  NEW pure function, no dependencies
    Tests for finding-filter.ts

Phase 2 — Context Infrastructure
    types.ts  →  add ReviewContext type
    context-gatherer.ts  →  NEW, depends on types.ts
    Tests for context-gatherer.ts (both shallow and deep paths)

Phase 3 — Prompt Layer Integration
    prompt.ts  →  MODIFY to accept ReviewContext (optional param)
    Tests for buildPrompt() and buildAgenticPrompt() with context

Phase 4 — CLI Wiring
    cli.ts  →  MODIFY to call gatherContext() and filterFindings()
    Integration tests via existing eval fixture infrastructure

Phase 5 — Prompt Calibration (quality tuning)
    prompt.ts  →  Improve FINDING_FORMAT_INSTRUCTIONS, MODE_OVERLAYS
    Validate with eval.ts fixture-based tests
```

**Why this order:**

- Phase 1 first: the filter is a pure function with no dependencies — safest to build and test in isolation. Also establishes the filtering contract before wiring.
- Phase 2 before Phase 3: `ReviewContext` type must exist before `prompt.ts` can reference it.
- Phase 3 before Phase 4: prompts must accept context before `cli.ts` can pass it.
- Phase 4 before Phase 5: wiring must be stable before iterating on prompt calibration — otherwise changes conflate wiring bugs with quality issues.
- Phase 5 last: prompt calibration is iterative and subjective. Building it last means it operates on a stable pipeline.

---

## Integration Points

### Existing Module → New Module Interfaces

| From | To | Data Passed | Change Type |
|------|-----|-------------|-------------|
| `cli.ts` | `context-gatherer.ts` | `PRData`, optional `clonePath` | New call site |
| `cli.ts` | `finding-filter.ts` | `ReviewFinding[]`, `ReviewMode` | New call site |
| `context-gatherer.ts` | `prompt.ts` | `ReviewContext` | New parameter |
| `prompt.ts` | `analyzer.ts` | Larger prompt strings | Transparent (no API change) |

### Modules That Do Not Change

| Module | Reason Unchanged |
|--------|-----------------|
| `analyzer.ts` | Thin subprocess wrapper; richer prompts are transparent to it |
| `schemas.ts` | `confidence` field already exists; no schema changes needed |
| `github.ts` | Read-only API surface unchanged |
| `output.ts` | Already sorts by severity+confidence; filtered findings are compatible |
| `html-report.ts` | Consumes `ReviewFinding[]` — no structural change |
| `formatter.ts` | Consumes individual `ReviewFinding` — no change |
| `diff-parser.ts` | Diff parsing unchanged |
| `review-builder.ts` | Consumes `ReviewFinding[]` — filtered input is compatible |
| `cloner.ts` | Clone logic unchanged |
| `prerequisites.ts` | No new prerequisites for context gathering |

---

## Scaling Considerations

This is a CLI tool — "scaling" means performance on large PRs and large repos, not concurrent users.

| Concern | Current | After Quality Changes |
|---------|---------|----------------------|
| Large diff (>80KB) | Truncated at 80KB | Unchanged — truncation stays |
| Large repo (deep mode) | Claude explores freely | Context gathering caps at 20 files, 500 lines each — adds <500ms |
| Many findings (>50) | All displayed | Filter removes low-signal findings — display is cleaner |
| Context prompt size | N/A | Cap context at 2KB total additions — well within Claude context window |

---

## Sources

- [Pipeline AI vs. Agentic AI for Code Reviews — CodeRabbit](https://www.coderabbit.ai/blog/pipeline-ai-vs-agentic-ai-for-code-reviews-let-the-model-reason-within-reason)
- [Effective Context Engineering for AI Agents — Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Drowning in AI Code Review Noise — Jet Xu Engineering Blog](https://jetxu-llm.github.io/posts/low-noise-code-review/)
- [Context Engineering Guide — Prompting Guide](https://www.promptingguide.ai/guides/context-engineering-guide)

---

*Architecture research for: codereview — quality improvement milestone*
*Researched: 2026-03-04*

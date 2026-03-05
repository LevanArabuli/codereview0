# Architecture Research

**Domain:** CLI tool with parallel AI agent review teams
**Researched:** 2026-03-05
**Confidence:** MEDIUM-HIGH (agent teams headless behavior verified via bug report; subprocess parallel pattern verified via official docs and community implementations)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLI Entry Layer                             │
│   cli.ts: Commander flag parsing, flow control, progress reporting   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │     team-analyzer.ts         │
              │  (new: parallel orchestrator)│
              └──┬────┬────┬────┬───────────┘
                 │    │    │    │
    ┌────────────▼┐ ┌─▼──┐ ┌▼──┐ ┌▼────────────┐
    │ security    │ │perf│ │qual│ │tests        │
    │ aspect      │ │    │ │    │ │ aspect      │
    │ subprocess  │ │    │ │    │ │ subprocess  │
    └─────────────┘ └────┘ └────┘ └─────────────┘
         (claude -p)  each aspect runs as a separate execFile call
                             │
              ┌──────────────▼──────────────┐
              │    finding-merger.ts          │
              │  (new: deduplicate + group)   │
              └──────────────┬───────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                       Existing Output Layer                          │
│  output.ts (terminal), review-builder.ts, github.ts, html-report.ts │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Not Agent Teams (Experimental Feature)

**CRITICAL FINDING** (MEDIUM confidence, verified via GitHub issue #29293 + official docs):

The `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` feature is designed for interactive terminal sessions. When a lead is invoked via `claude -p` (headless/non-interactive), teammate spawning fails with:

```
Error: Input must be provided either through stdin or as a prompt argument when using --print
```

Root cause: When the lead uses `TeamCreate`/`Task` tools to spawn teammate subprocesses, the spawning mechanism does not pipe the initial prompt to teammate stdin. This is a known bug (closed as duplicate of #27729 as of March 2026, no fix timeline).

**Consequence:** The user's stated preference for "agent teams API" is blocked by this experimental limitation. The correct integration pattern for a non-interactive CLI tool is **DIY parallel subprocesses**, which is what the codebase already does for quick/deep modes.

### Component Responsibilities

| Component | Responsibility | Where |
|-----------|----------------|-------|
| `cli.ts` (existing) | Entry point, flag parsing, flow control, graceful fallback | `src/cli.ts` |
| `analyzer.ts` (existing) | Single-agent subprocess invocation, JSON parsing, Zod validation | `src/analyzer.ts` |
| `team-analyzer.ts` (new) | Spawn 4 parallel aspect subprocesses, collect results, hand to merger | `src/team-analyzer.ts` |
| `team-prompt.ts` (new) | Build aspect-specific prompts (security/performance/quality/tests) | `src/team-prompt.ts` |
| `finding-merger.ts` (new) | Deduplicate cross-aspect findings, preserve aspect grouping | `src/finding-merger.ts` |
| `types.ts` (extend) | Add `AspectFinding`, `AspectResult`, `ReviewAspect` types | `src/types.ts` |
| `schemas.ts` (extend) | Extend `ReviewFindingSchema` with optional `aspect` field | `src/schemas.ts` |
| `output.ts` (extend) | Print findings grouped by aspect in terminal | `src/output.ts` |
| `review-builder.ts` (extend) | Build GitHub review body with aspect section headers | `src/review-builder.ts` |
| `html-report.ts` (extend) | Render HTML report with aspect tabs or sections | `src/html-report.ts` |

## Recommended Project Structure

```
src/
├── cli.ts              # Existing — add teams flow branch
├── analyzer.ts         # Existing — unchanged (single-agent path preserved)
├── team-analyzer.ts    # NEW: parallel aspect subprocess orchestrator
├── team-prompt.ts      # NEW: aspect-specific prompt builders
├── finding-merger.ts   # NEW: cross-aspect deduplication logic
├── types.ts            # Extend with AspectFinding, ReviewAspect, AspectResult
├── schemas.ts          # Extend ReviewFindingSchema with optional aspect field
├── output.ts           # Extend with printAspectFindings()
├── review-builder.ts   # Extend with aspect-section GitHub body builder
├── prompt.ts           # Existing — unchanged (used by team-prompt.ts as base)
├── github.ts           # Existing — unchanged
├── cloner.ts           # Existing — unchanged
├── ...                 # All other modules unchanged
tests/
├── team-analyzer.test.ts   # NEW
├── team-prompt.test.ts     # NEW
├── finding-merger.test.ts  # NEW
├── ...                     # Existing tests unchanged
```

### Structure Rationale

- **`team-analyzer.ts` separate from `analyzer.ts`:** The team path is additive, not a replacement. Keeping them separate preserves the single-agent fallback path without conditional branching inside the core analyzer. Tests for each path remain independent.
- **`team-prompt.ts` separate from `prompt.ts`:** Aspect prompts are specialized and substantially different from the existing quick/agentic prompts. Separation avoids bloating the existing module.
- **`finding-merger.ts`:** Deduplication is non-trivial (same bug reported by multiple agents) and benefits from isolated testing with fixtures.

## Architectural Patterns

### Pattern 1: DIY Parallel Subprocess Fan-Out

**What:** Spawn N `claude -p` processes concurrently using `Promise.all()`, where each subprocess receives a specialized prompt for one review aspect. Collect all JSON responses, then merge.

**When to use:** Whenever you need parallel AI analysis from a non-interactive caller. This is what the official Claude Code headless docs recommend and what community parallel-review implementations actually use.

**Trade-offs:** No inter-agent communication (aspects work independently); requires explicit deduplication step; uses N * (single-call cost) tokens. This is intentional — the project spec says "agents review independently, lead synthesizes."

**Example:**

```typescript
// src/team-analyzer.ts (sketch)
export async function analyzeTeam(
  prData: PRData,
  model?: string,
  mode?: ReviewMode,
): Promise<AspectResult[]> {
  const aspects: ReviewAspect[] = ['security', 'performance', 'quality', 'tests'];

  // Fan out: 4 parallel subprocess calls
  const results = await Promise.allSettled(
    aspects.map(aspect =>
      analyzeAspect(prData, aspect, model, mode)
    )
  );

  // Collect successful results; log failures but don't abort
  return results
    .map((r, i) => r.status === 'fulfilled'
      ? r.value
      : { aspect: aspects[i], findings: [], error: (r.reason as Error).message }
    );
}

async function analyzeAspect(
  prData: PRData,
  aspect: ReviewAspect,
  model?: string,
  mode?: ReviewMode,
): Promise<AspectResult> {
  const prompt = buildAspectPrompt(prData, aspect, mode);
  const args = ['-p', prompt, '--output-format', 'json', '--max-turns', '10'];
  if (model) args.push('--model', model);

  const { stdout } = await execFile('claude', args, {
    timeout: ASPECT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf-8',
    env: filterEnv(),
  });

  const wrapper = JSON.parse(stdout) as ClaudeResponse;
  const findings = parseClaudeResponse(wrapper.result);
  return { aspect, findings, meta: buildMeta(wrapper) };
}
```

### Pattern 2: Graceful Partial Failure

**What:** Use `Promise.allSettled()` (not `Promise.all()`) so that a single aspect failure does not abort the entire review. Fulfilled aspects produce findings; rejected aspects produce a warning message.

**When to use:** Always for parallel subprocess fan-out. Individual aspects can time out or fail without killing the whole review.

**Trade-offs:** Review may be incomplete if an aspect fails; user must be informed. This is better than a complete failure for a partial result.

**Example:**

```typescript
// Partial failure handling
const results = await Promise.allSettled(aspectPromises);
const succeeded = results.filter(r => r.status === 'fulfilled').length;
if (succeeded < aspects.length) {
  printWarning(`${aspects.length - succeeded} aspect(s) failed — review may be incomplete`);
}
```

### Pattern 3: Feature Detection Gate

**What:** Before entering the team path, check whether agent teams are available (env var set and CLI version supports it) OR whether DIY parallel is available (simpler: just whether `claude` is present). Use `--version` or a dry-run check to detect capability.

**When to use:** To implement the graceful degradation requirement (fall back to single-agent if teams unavailable).

**Trade-offs:** Adds startup check latency; but prerequisite checking already exists in the codebase (`prerequisites.ts`) so the pattern is established.

**Example:**

```typescript
// Capability detection: env var check (set by user to opt in, or always-on)
function isTeamModeEnabled(): boolean {
  // Simple: always attempt parallel when requested, fall back on error
  // OR: check env var for explicit opt-out
  return process.env.CODEREVIEW_DISABLE_TEAMS !== '1';
}
```

## Data Flow

### Team Review Request Flow

```
User runs: codereview <pr-url>
    |
    v
cli.ts: parse flags, check prerequisites
    |
    v
github.ts: fetchPRData() → PRData { title, diff, files, ... }
    |
    v
cli.ts: choose path
    |                           |
  team path                single-agent path (unchanged)
    |
    v
team-analyzer.ts: analyzeTeam(prData)
    |
    +── execFile('claude', ['-p', securityPrompt]) ──→ AspectResult(security)
    +── execFile('claude', ['-p', perfPrompt])     ──→ AspectResult(performance)
    +── execFile('claude', ['-p', qualityPrompt])  ──→ AspectResult(quality)
    +── execFile('claude', ['-p', testsPrompt])    ──→ AspectResult(tests)
    |
    v (Promise.allSettled: all 4 complete or fail independently)
    |
    v
finding-merger.ts: mergeAspectResults()
    ├── deduplicates findings that appear across multiple aspects
    └── returns FindingsByAspect: { security: [...], performance: [...], ... }
    |
    v
output.ts: printAspectFindings(findingsByAspect)   → terminal (grouped by aspect)
review-builder.ts: buildAspectReviewBody(...)       → GitHub review sections
html-report.ts: generateAspectHtmlReport(...)       → HTML with aspect tabs
    |
    v
github.ts: postReview() (PENDING, unchanged)
```

### Key Data Flows

1. **Prompt fan-out:** `team-prompt.ts` calls `buildAspectPrompt(prData, aspect)` which builds on top of the existing `buildPrompt()` base, adding aspect-specific focus instructions. The PR diff is the same for all aspects — only the focus instructions differ.

2. **Findings merge:** Each `AspectResult` has `{ aspect, findings[], meta }`. The merger deduplicates by comparing (file, line, message) tuples across aspects — a finding reported by both security and quality agents should appear once, attributed to security (higher priority aspect ordering).

3. **Aspect attribution:** The `ReviewFinding` schema gains an optional `aspect` field. Aspect agents are prompted to include their aspect name in each finding's metadata. The merger also back-fills aspect on untagged findings.

4. **Terminal grouping:** `output.ts` groups findings by aspect before sorting by severity within each group. Section headers (`SECURITY`, `PERFORMANCE`, etc.) precede each group.

## Scaling Considerations

This is a CLI tool, not a service. Scaling here means review quality and performance characteristics, not user count.

| Concern | Current (single-agent) | Team mode (4 agents) |
|---------|------------------------|----------------------|
| Token cost per review | ~200K tokens | ~400-800K tokens (4x depth, partial overlap) |
| Wall-clock time | Sequential turns | Parallel; bounded by slowest aspect |
| Claude API rate limits | Single session | 4 concurrent sessions — may hit rate limits at high volume |
| Memory / buffer | 10MB max buffer | 4x 10MB = 40MB worst case |
| Timeout | 5 min (quick), 10 min (deep) | Each aspect gets same timeout independently |

**Token cost note (MEDIUM confidence):** Each aspect agent runs `claude -p` independently. They do not share context, so the same diff is tokenized 4 times. A 200K-token single review becomes ~4x for 4 agents reviewing the same diff. This is by design — deeper coverage, known cost.

## Anti-Patterns

### Anti-Pattern 1: Using `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` as the Subprocess Driver

**What people do:** Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in the subprocess env, invoke `claude -p`, expect it to coordinate teammates.

**Why it's wrong:** The experimental agent teams feature requires an interactive terminal. Teammate spawning immediately fails with "Input must be provided either through stdin or as a prompt argument when using --print" (GitHub issue #29293, March 2026, no fix). The feature is designed for interactive use only.

**Do this instead:** Implement parallel review as four independent `execFile('claude', ['-p', aspectPrompt])` calls wrapped in `Promise.allSettled()`. This is the pattern the codebase already uses; extend it.

### Anti-Pattern 2: Using `Promise.all()` for Aspect Subprocesses

**What people do:** `await Promise.all([securityReview(), perfReview(), ...])`

**Why it's wrong:** If any single aspect times out or fails, the entire team review throws, producing zero findings for the user instead of partial results.

**Do this instead:** Use `Promise.allSettled()`. Collect fulfilled results, warn about failures, proceed with partial findings. A security review with a failed performance aspect is still valuable.

### Anti-Pattern 3: Injecting Aspect Results Back Through a Lead Session

**What people do:** Invoke a lead `claude -p` session, have it spawn aspect agents as subagents, collect their results. This is the agent teams pattern applied programmatically.

**Why it's wrong:** Subagents work within a single interactive session and cannot be invoked programmatically as isolated subprocesses from a CLI caller. The lead would need to run interactively, defeating the CLI use case. Additionally, this adds a synthesis turn that costs tokens and time without benefit — the merger module can deduplicate more deterministically than a Claude synthesis step.

**Do this instead:** DIY parallel subprocess fan-out (Pattern 1). The merger module handles deduplication deterministically, without paying for an extra Claude turn.

### Anti-Pattern 4: Merging All Aspects Into a Single Flat Findings List

**What people do:** Collect all findings from all aspects, sort by severity, output as a flat list identical to the existing single-agent format.

**Why it's wrong:** This throws away the aspect grouping that is the entire value of the team review. A security finding and a performance finding at the same severity rank are not interchangeable — the user wants to know which lens found what.

**Do this instead:** Group by aspect first, sort by severity within each aspect group. In terminal output, use section headers. In GitHub reviews, use aspect-labeled comment headers.

## Integration Points

### New Module Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `cli.ts` → `team-analyzer.ts` | Direct async call: `analyzeTeam(prData, model?, mode?)` | Mirrors the existing `analyzeDiff()` call signature |
| `team-analyzer.ts` → `team-prompt.ts` | Direct call: `buildAspectPrompt(prData, aspect, mode)` | Returns string prompt per aspect |
| `team-analyzer.ts` → `analyzer.ts` (shared) | `filterEnv()`, `parseClaudeResponse()`, `buildMeta()` — reuse directly | No duplication |
| `team-analyzer.ts` → `finding-merger.ts` | `mergeAspectResults(results: AspectResult[])` → `FindingsByAspect` | Clean handoff |
| `finding-merger.ts` → `output.ts` | `printAspectFindings(findingsByAspect)` | New function in output.ts |
| `finding-merger.ts` → `review-builder.ts` | `buildAspectReviewBody(findingsByAspect, prData)` | Extension of existing builder |

### Existing Module Contracts (Unchanged)

| Module | Why Unchanged |
|--------|---------------|
| `analyzer.ts` | Single-agent path preserved; team path is additive |
| `cloner.ts` | Deep mode clone logic unchanged; team review works with or without clone |
| `github.ts` | `postReview()` called with merged findings at the end; unaffected by aspect grouping |
| `errors.ts` | `scrubSecrets()`, `sanitizeError()` — called by team-analyzer.ts for all subprocess output |
| `diff-parser.ts` | Finding routing uses the merged flat findings list; aspect grouping is orthogonal |
| `prerequisites.ts` | No new prerequisite; `claude` CLI already required |

### Build Order (Dependencies)

Build these components in this order to allow incremental testing:

1. **`types.ts` extensions** — `ReviewAspect`, `AspectResult`, `FindingsByAspect` types needed by all new modules. No logic, just types.

2. **`schemas.ts` extension** — Add optional `aspect` field to `ReviewFindingSchema`. Zero risk to existing tests.

3. **`team-prompt.ts`** — Aspect prompt builders. Pure function, no subprocess. Testable in isolation with `tests/team-prompt.test.ts`.

4. **`team-analyzer.ts`** — Core parallel subprocess orchestrator. Depends on `team-prompt.ts`, `filterEnv()` from `analyzer.ts`, `parseClaudeResponse()` from `analyzer.ts`. Testable by mocking `execFile`.

5. **`finding-merger.ts`** — Deduplication logic. Depends on `AspectResult` type only. Testable with pure-data fixtures.

6. **`output.ts` extension** — `printAspectFindings()`. Depends on `FindingsByAspect`. Extend existing tests.

7. **`review-builder.ts` extension** — Aspect-grouped GitHub body. Depends on `FindingsByAspect`.

8. **`html-report.ts` extension** — Aspect sections/tabs in HTML. Depends on `FindingsByAspect`. Build last; HTML generation is the most isolated.

9. **`cli.ts` wiring** — Connect the team path to the existing orchestration flow. Add `--no-teams` opt-out flag and graceful fallback.

## Sources

- [Orchestrate teams of Claude Code sessions - Official Docs](https://code.claude.com/docs/en/agent-teams) — HIGH confidence
- [GitHub Issue #29293: Agent Teams fail in headless/print mode](https://github.com/anthropics/claude-code/issues/29293) — HIGH confidence (verified bug, closed as duplicate)
- [Run Claude Code programmatically - Official Docs](https://code.claude.com/docs/en/headless) — HIGH confidence
- [Create custom subagents - Official Docs](https://code.claude.com/docs/en/sub-agents) — HIGH confidence
- [9 Parallel AI Agents That Review My Code (HAMY)](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents) — MEDIUM confidence (community implementation showing subagent parallel review pattern)
- [Multi-Agent Orchestration: Running 10+ Claude Instances in Parallel](https://dev.to/bredmond1019/multi-agent-orchestration-running-10-claude-instances-in-parallel-part-3-29da) — MEDIUM confidence (DIY parallel subprocess pattern)
- [Building a C compiler with a team of parallel Claudes - Anthropic](https://www.anthropic.com/engineering/building-c-compiler) — HIGH confidence (Anthropic-authored parallel Claude pattern)

---
*Architecture research for: codereview agent teams integration*
*Researched: 2026-03-05*

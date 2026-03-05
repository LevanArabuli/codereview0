# Phase 1: Orchestration Foundation - Research

**Researched:** 2026-03-05
**Domain:** Node.js subprocess orchestration, parallel Claude CLI invocation, finding deduplication
**Confidence:** HIGH

## Summary

Phase 1 transforms the existing single-agent CLI review tool into a multi-agent parallel review system. The core challenge is orchestrating four concurrent `claude -p` subprocess invocations (one per aspect: security, performance, quality, tests), merging their output into a unified `ReviewFinding[]`, deduplicating overlapping findings, handling partial failures gracefully, and extending security hardening.

The existing codebase is well-structured for this change. The `analyzer.ts` module already encapsulates both `analyzeDiff()` (quick mode via `execFile`) and `analyzeAgentic()` (deep mode via `spawn`) with proper JSON parsing, Zod validation, and error handling. The `prompt.ts` module uses a composable overlay pattern (`MODE_OVERLAYS`) that directly maps to the needed aspect overlay pattern. The `schemas.ts` Zod schema and `ReviewFinding` type are the only schema touchpoints. No new dependencies are needed -- `Promise.allSettled()` is built into Node.js, Commander already supports `--no-*` negatable options, and string similarity for deduplication can use a simple Levenshtein implementation (under 30 lines, no library needed).

**Primary recommendation:** Build a new `orchestrator.ts` module that wraps the existing `analyzeDiff`/`analyzeAgentic` functions, fans out to four aspect-specific calls via `Promise.allSettled()`, stamps `aspect` tags on results, deduplicates, and returns the same `AnalysisResult` shape. The CLI routes through this orchestrator by default, with `--no-team` bypassing to the existing single-agent path.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Each aspect agent reports ONLY findings in its domain -- strict separation (security agent ignores non-security issues, etc.)
- All 4 agents receive the full PR diff (no per-aspect file filtering)
- In deep mode (cloned repo), all 4 aspect agents run as agentic sessions with codebase access
- Prompt design: shared base prompt (existing structure) + aspect-specific overlay per domain (similar to how review mode overlays work today)
- Deduplicate to a single finding; tag with the primary aspect (whichever agent's domain is most natural for that issue)
- Match rule: same file + overlapping lines (within a few lines) + semantically similar description
- Winner selection: higher severity wins when two aspects surface the same issue
- Dedup stats shown in `--verbose` mode (e.g., "12 raw findings, 9 after dedup") -- consistent with existing verbose debug output pattern
- Explicit per-aspect status shown to user (e.g., "Security: done, Performance: done, Quality: failed (timeout), Tests: done")
- Exit code 0 with warnings when some aspects fail but others succeed -- partial success is still success
- If ALL 4 aspect agents fail, auto-fallback to single-agent generalist review (consistent with existing deep-to-quick fallback pattern)
- Same timeout per aspect as current single-agent: 5 min (quick mode) / 10 min (deep mode). Since they run in parallel, total wall time stays similar
- Same review mode overlay (strict/detailed/lenient/balanced) applied to all 4 aspect agents
- All 4 aspects run in every mode -- no aspect suppression based on mode
- Aspect labels are separate from severity: `aspect: 'security' | 'performance' | 'quality' | 'tests'`. The 'security' collision with severity 'security' is accepted (aspect = who found it, severity = how bad it is)
- Team mode (4 parallel agents) is the DEFAULT behavior. `--no-team` opts out to single-agent

### Claude's Discretion
- Exact dedup matching algorithm (string similarity threshold, line proximity window)
- Aspect overlay prompt wording -- as long as each is expert-scoped and domain-specific
- How the auto-fallback to generalist is triggered (all-fail detection logic)
- Per-aspect max-turns setting

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SYNTH-02 | `ReviewFinding` schema has optional `aspect` field | Zod v4 `.optional()` on enum field; backwards-compatible addition to existing schema |
| ORCH-06 | Each aspect agent receives a focused, expert-scoped prompt | `ASPECT_OVERLAYS` pattern mirroring existing `MODE_OVERLAYS` Record pattern in prompt.ts |
| ORCH-01 | Tool spawns 4 parallel aspect reviewers | `Promise.allSettled()` with 4 concurrent `execFile`/`spawn` calls wrapping existing analyzer functions |
| ORCH-02 | Partial aspect failure does not abort the full review | `Promise.allSettled()` returns `{status: 'fulfilled'|'rejected'}` per promise -- filter fulfilled results |
| ORCH-03 | Parallel review works in quick mode | Fan-out wraps `analyzeDiff()` -- each call gets aspect-augmented prompt |
| ORCH-04 | Parallel review works in deep mode | Fan-out wraps `analyzeAgentic()` -- each call gets aspect-augmented prompt with same `clonePath` |
| ORCH-05 | `--no-team` flag for single-agent fallback | Commander negatable option `--no-team` defaults team=true, bypasses orchestrator |
| SYNTH-01 | Deduplication using file + line + description similarity | Levenshtein distance on descriptions + line proximity window (no external dependency) |
| SYNTH-03 | All aspect findings merge into single `ReviewFinding[]` | Orchestrator concatenates per-aspect arrays, stamps `aspect` field, deduplicates, returns merged array |
| SEC-01 | `filterEnv()` strips `ANTHROPIC_BASE_URL` | Add to `DANGEROUS_EXACT` set in analyzer.ts |
| SEC-02 | Credential scrubbing on all 4 agent outputs | Already applied -- `analyzeAgentic` uses `scrubSecrets()` on stderr; orchestrator inherits this |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `child_process` | N/A (Node >= 22) | `execFile`/`spawn` for Claude CLI subprocesses | Already used; security invariant requires `execFile` not `exec` |
| `Promise.allSettled()` | ES2020 built-in | Parallel subprocess orchestration with partial failure tolerance | Returns all results regardless of individual rejections |
| Zod | v4.3.6 | Schema validation for `ReviewFinding` with new `aspect` field | Already in use; `.optional()` for backwards compatibility |
| Commander | v14.0.3 | CLI flag parsing for `--no-team` | Already in use; supports negatable boolean options natively |
| picocolors | v1.1.1 | Terminal output for aspect status messages | Already in use; project convention (not chalk) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | - | No new dependencies needed. String similarity is hand-rolled (~25 lines). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled Levenshtein | `string-similarity` npm | Violates 4-dep budget; Levenshtein is trivial to implement |
| `Promise.allSettled()` | `Promise.all()` with `.catch()` wrappers | `allSettled` is cleaner, purpose-built for partial failure |
| New orchestrator module | Inline in cli.ts | cli.ts is already complex; orchestrator deserves its own module for testability |

**Installation:**
```bash
# No new dependencies required
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  orchestrator.ts    # NEW: Fan-out, merge, dedup logic
  analyzer.ts        # MODIFIED: Export filterEnv, add ANTHROPIC_BASE_URL to blocklist
  prompt.ts          # MODIFIED: Add ASPECT_OVERLAYS, aspect-augmented prompt builders
  schemas.ts         # MODIFIED: Add optional aspect field to ReviewFindingSchema
  types.ts           # UNCHANGED (ReviewFinding type auto-derived from Zod schema)
  cli.ts             # MODIFIED: Add --no-team flag, route through orchestrator
  errors.ts          # UNCHANGED (scrubSecrets already applied in analyzer paths)
  output.ts          # UNCHANGED in Phase 1 (Phase 2 adds aspect grouping)
```

### Pattern 1: Aspect Overlay (mirrors MODE_OVERLAYS)
**What:** A `Record<AspectType, string>` mapping aspect names to prompt overlay paragraphs, composed with the existing mode overlay.
**When to use:** When building prompts for aspect-specific agents.
**Example:**
```typescript
// In prompt.ts
export const ASPECT_TYPES = ['security', 'performance', 'quality', 'tests'] as const;
export type AspectType = typeof ASPECT_TYPES[number];

const ASPECT_OVERLAYS: Record<AspectType, string> = {
  security: `\n\nASPECT FOCUS — SECURITY EXPERT: You are a security specialist...`,
  performance: `\n\nASPECT FOCUS — PERFORMANCE EXPERT: You are a performance engineer...`,
  quality: `\n\nASPECT FOCUS — CODE QUALITY EXPERT: You are a code quality specialist...`,
  tests: `\n\nASPECT FOCUS — TEST COVERAGE EXPERT: You are a testing specialist...`,
};

// Compose: base prompt + mode overlay + aspect overlay
export function buildAspectPrompt(prData: PRData, mode?: ReviewMode, aspect?: AspectType): string {
  const base = buildPrompt(prData, mode);
  if (!aspect) return base;
  return base + ASPECT_OVERLAYS[aspect];
}
```

### Pattern 2: Promise.allSettled Fan-Out
**What:** Launch 4 concurrent subprocess calls, collect all results regardless of individual failures.
**When to use:** For the team orchestrator in both quick and deep modes.
**Example:**
```typescript
// In orchestrator.ts
const aspectPromises = ASPECT_TYPES.map(aspect =>
  analyzeDiffWithAspect(prData, model, mode, aspect)
    .then(result => ({ aspect, result }))
);

const settled = await Promise.allSettled(aspectPromises);

const succeeded: { aspect: AspectType; result: AnalysisResult }[] = [];
const failed: { aspect: AspectType; reason: string }[] = [];

for (const [i, outcome] of settled.entries()) {
  if (outcome.status === 'fulfilled') {
    succeeded.push(outcome.value);
  } else {
    failed.push({ aspect: ASPECT_TYPES[i], reason: outcome.reason?.message ?? 'Unknown error' });
  }
}
```

### Pattern 3: Aspect Stamping Post-Parse
**What:** After parsing findings from each aspect agent, stamp the `aspect` field on each finding.
**When to use:** After `parseClaudeResponse()` returns findings from each aspect subprocess.
**Example:**
```typescript
// Stamp aspect on each finding from a specific agent
function stampAspect(findings: ReviewFinding[], aspect: AspectType): ReviewFinding[] {
  return findings.map(f => ({ ...f, aspect }));
}
```

### Pattern 4: Commander Negatable Option (--no-team)
**What:** Commander's built-in support for `--no-*` boolean flags.
**When to use:** For the `--no-team` flag that opts out of parallel review.
**Example:**
```typescript
// In cli.ts
program
  .option('--no-team', 'Run single-agent review instead of parallel team review')
  // ...
  .action(async (prUrl, options: { team?: boolean; /* ... */ }) => {
    // options.team defaults to true
    // --no-team sets options.team to false
    if (!options.team) {
      console.log(pc.dim('Single-agent mode'));
      // Use existing single-agent path
    } else {
      // Route through orchestrator
    }
  });
```

**Important Commander detail:** When you define `--no-team`, Commander automatically:
- Sets `options.team` to `true` by default
- Provides `--no-team` flag that sets it to `false`
- The property name is `team` (without the `no-` prefix)

### Pattern 5: Deduplication with Levenshtein + Line Proximity
**What:** Simple dedup algorithm comparing file, line proximity, and description similarity.
**When to use:** After merging findings from all 4 aspect agents.
**Example:**
```typescript
function deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const kept: ReviewFinding[] = [];

  for (const finding of findings) {
    const isDuplicate = kept.some(existing =>
      existing.file === finding.file &&
      Math.abs(existing.line - finding.line) <= 3 &&
      descriptionSimilarity(existing.description, finding.description) > 0.6
    );

    if (!isDuplicate) {
      kept.push(finding);
    }
    // If duplicate: keep existing (which has higher severity per sorting)
  }

  return kept;
}
```

### Anti-Patterns to Avoid
- **Do NOT filter files per aspect:** All 4 agents receive the full diff. The aspect overlay constrains what they report, not what they see.
- **Do NOT share a single `spawn` session across aspects:** Each aspect gets its own independent subprocess. No inter-process communication needed.
- **Do NOT add dependencies for string similarity:** Levenshtein is ~25 lines. The 4-dep budget is a hard constraint.
- **Do NOT modify `analyzeDiff`/`analyzeAgentic` signatures significantly:** The orchestrator wraps them; internal changes should be minimal (export `filterEnv`, accept aspect parameter for prompt building).
- **Do NOT implement aspect-grouped output in Phase 1:** That is Phase 2. Phase 1 produces the merged `ReviewFinding[]` -- existing output functions display it as-is (findings have the `aspect` field but output ignores it until Phase 2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parallel execution with partial failure | Custom event emitter/callback pattern | `Promise.allSettled()` | Built-in, purpose-designed, zero complexity |
| CLI boolean flag with negation | Manual arg parsing for `--no-team` | Commander negatable options | Already in dependency, handles edge cases |
| Zod schema extension | Manual type assertions | `z.enum([...]).optional()` | Type-safe, consistent with existing pattern |

**Key insight:** This phase adds significant functionality but requires zero new dependencies. Everything needed is already in the runtime (Promise.allSettled), existing dependencies (Commander, Zod), or trivially implementable (Levenshtein in ~25 lines).

## Common Pitfalls

### Pitfall 1: Deep Mode Concurrent cwd Conflicts
**What goes wrong:** All 4 `analyzeAgentic()` calls use the same `clonePath` as `cwd`. If the Claude CLI modifies working state (files, git state) in one session, it could affect others.
**Why it happens:** `spawn({ cwd: clonePath })` shares the same filesystem directory across 4 concurrent processes.
**How to avoid:** The agentic prompt already includes "NEVER modify any files" as a guardrail. The read-only constraint means concurrent access to the same clone directory is safe. Reinforce this in the aspect overlay prompts as well. Do NOT clone the repo 4 times -- that would be wasteful and slow.
**Warning signs:** Test with a PR that triggers write-like suggestions from Claude to verify no file modifications occur.

### Pitfall 2: Double Timeout (Per-Agent + Overall)
**What goes wrong:** If you add an overall orchestrator timeout on top of per-agent timeouts, edge cases arise (agent completes just as orchestrator times out, losing results).
**Why it happens:** Layered timeout management is complex.
**How to avoid:** Use ONLY per-agent timeouts (5min quick, 10min deep) as the decision document specifies. The orchestrator does not need its own timeout -- `Promise.allSettled()` resolves when all agents resolve/reject, and each agent has its own timeout. Wall time for team review is approximately equal to the slowest single agent.
**Warning signs:** Findings from a completed agent appearing as "lost" in output.

### Pitfall 3: filterEnv Not Applied to Quick Mode
**What goes wrong:** Currently `filterEnv()` is only used in `analyzeAgentic()` (the `spawn` call). The `analyzeDiff()` function (quick mode via `execFile`) does NOT call `filterEnv()` -- it inherits `process.env` by default.
**Why it happens:** Quick mode was considered lower-risk (no codebase access), so env filtering was only applied to deep mode.
**How to avoid:** For Phase 1, `filterEnv()` must be applied to ALL 4 subprocess calls in both modes. Either: (a) modify `analyzeDiff()` to accept and use a filtered env, or (b) have the orchestrator pass `env: filterEnv()` through to each call. The SEC-01 requirement says "strips `ANTHROPIC_BASE_URL` from ALL subprocess environments."
**Warning signs:** Security test checking `filterEnv()` usage only in `analyzeAgentic` but not `analyzeDiff`.

### Pitfall 4: Dedup Ordering Affects Winner Selection
**What goes wrong:** The dedup algorithm should keep higher-severity findings when duplicates are found. If findings are processed in arbitrary order, a lower-severity duplicate might be kept instead.
**Why it happens:** `Promise.allSettled()` returns results in submission order, but the merged array order matters for dedup winner selection.
**How to avoid:** Sort findings by severity (bug > security > suggestion > nitpick) BEFORE deduplication. The first occurrence (highest severity) is kept; subsequent duplicates are dropped.
**Warning signs:** A `nitpick` finding surviving dedup when a `bug` finding for the same location was also present.

### Pitfall 5: Zod Schema Change Breaks Response Parsing
**What goes wrong:** Adding `aspect` to the Zod schema could cause Claude's JSON output (which does NOT include `aspect`) to fail validation.
**Why it happens:** If `aspect` is not marked `.optional()`, Zod will reject Claude's response JSON.
**How to avoid:** The `aspect` field MUST be `.optional()` in the schema. Claude agents do NOT output an `aspect` field -- it is stamped by the orchestrator after parsing. The schema addition is purely for downstream consumers. Verify that all existing tests still pass with the schema change (they should, since existing test data has no `aspect` field).
**Warning signs:** Existing `analyzer.test.ts` or `eval.test.ts` fixtures failing after schema change.

### Pitfall 6: Aspect Prompt Wording Causes JSON Format Drift
**What goes wrong:** Aspect overlay prompts might confuse Claude about the output format, causing it to return non-JSON or differently structured output.
**Why it happens:** Multiple overlay sections (mode + aspect) appended to the base prompt could create conflicting instructions.
**How to avoid:** Aspect overlays should ONLY constrain what issues to report. They must NOT restate or modify the JSON output format instructions. Place the aspect overlay AFTER the mode overlay to maintain instruction hierarchy: base prompt (includes JSON format) -> mode overlay (scope/thoroughness) -> aspect overlay (domain focus).
**Warning signs:** Parse failures in one aspect but not others; aspect agents returning different JSON shapes.

### Pitfall 7: All-Fail Fallback Creates Infinite Retry Risk
**What goes wrong:** If all 4 aspects fail and the auto-fallback to single-agent also fails, the user gets no review and a confusing error.
**Why it happens:** The fallback path re-invokes analysis, which could hit the same underlying issue (API rate limit, network failure, etc.).
**How to avoid:** The all-fail fallback should attempt the single-agent generalist review ONCE. If that also fails, report the error clearly. Do not retry the team approach. The existing `analyzeDiff` already has retry-once logic (`MAX_ATTEMPTS = 2`), so the fallback benefits from that.
**Warning signs:** Long-running reviews that seem stuck (retrying in a loop).

## Code Examples

### Schema Extension (schemas.ts)
```typescript
// Source: Existing schemas.ts + Zod v4 docs
import { z } from 'zod';

// Add aspect type enum
export const AspectTypeSchema = z.enum(['security', 'performance', 'quality', 'tests']);

export const ReviewFindingSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  endLine: z.number().int().optional(),
  severity: z.enum(['bug', 'security', 'suggestion', 'nitpick']),
  confidence: z.enum(['high', 'medium', 'low']),
  category: z.string(),
  description: z.string(),
  suggestedFix: z.string().optional(),
  relatedLocations: z.array(RelatedLocationSchema).optional(),
  aspect: AspectTypeSchema.optional(),  // NEW: optional aspect tag
});
```

### Levenshtein Distance (for orchestrator.ts)
```typescript
// Source: Standard Wagner-Fischer algorithm, no dependency needed
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function descriptionSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}
```

### filterEnv Extension (analyzer.ts)
```typescript
// Add ANTHROPIC_BASE_URL to the exact blocklist
const DANGEROUS_EXACT = new Set(['DATABASE_URL', 'REDIS_URL', 'ANTHROPIC_BASE_URL']);
```

### Commander --no-team Flag (cli.ts)
```typescript
program
  .option('--no-team', 'Run single-agent review (skip parallel team review)')
  // options.team: boolean (defaults to true, --no-team sets to false)
```

### Orchestrator Core (orchestrator.ts, simplified)
```typescript
import { ASPECT_TYPES, type AspectType } from './prompt.js';
import type { AnalysisResult } from './analyzer.js';
import type { ReviewFinding } from './schemas.js';

interface TeamResult {
  findings: ReviewFinding[];
  model: string;
  aspectStatus: Record<AspectType, 'done' | 'failed'>;
  rawCount: number;   // Before dedup (for --verbose)
}

export async function analyzeTeam(
  analyzeOne: (aspect: AspectType) => Promise<AnalysisResult>,
): Promise<TeamResult> {
  const settled = await Promise.allSettled(
    ASPECT_TYPES.map(aspect =>
      analyzeOne(aspect).then(r => ({ aspect, ...r }))
    )
  );

  // Partition results
  const allFindings: ReviewFinding[] = [];
  const aspectStatus: Record<string, 'done' | 'failed'> = {};
  let model = 'unknown';

  for (const [i, outcome] of settled.entries()) {
    const aspect = ASPECT_TYPES[i];
    if (outcome.status === 'fulfilled') {
      const stamped = outcome.value.findings.map(f => ({ ...f, aspect }));
      allFindings.push(...stamped);
      aspectStatus[aspect] = 'done';
      model = outcome.value.model;
    } else {
      aspectStatus[aspect] = 'failed';
    }
  }

  // All failed? Return empty -- caller handles fallback
  const rawCount = allFindings.length;
  const deduplicated = deduplicateFindings(allFindings);

  return {
    findings: deduplicated,
    model,
    aspectStatus: aspectStatus as Record<AspectType, 'done' | 'failed'>,
    rawCount,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Claude Code agent teams API (internal subagents) | DIY parallel `claude -p` subprocesses | Decision during roadmap phase (2026-03-05) | Agent teams API non-functional in non-interactive subprocess context (GitHub issue #29293) |
| Single `claude -p` call | 4 concurrent `claude -p` calls via Promise.allSettled | This phase | 4x parallelism, same wall time, ~4x token cost |

**Important note on REQUIREMENTS.md vs actual implementation:** ORCH-01 text says "single `claude` CLI session whose prompt instructs it to use built-in subagents (Task tool)" but the implementation decision (recorded in STATE.md and CONTEXT.md) is DIY parallel subprocesses. The REQUIREMENTS.md text is stale. The ROADMAP success criteria and CONTEXT.md are authoritative.

**Deprecated/outdated:**
- Claude Code agent teams API for non-interactive subprocess use: confirmed non-functional (GitHub issue #29293)

## Open Questions

1. **Per-aspect max-turns setting**
   - What we know: Current quick mode uses `MAX_ANALYSIS_TURNS = 10`, deep mode uses `MAX_AGENTIC_TURNS = 75`
   - What's unclear: Whether aspect agents need different max-turns than the generalist. An aspect-scoped agent might need fewer turns since its focus is narrower.
   - Recommendation: Start with same max-turns as current (10 quick, 75 deep). Aspect agents are doing the same work, just scoped. Adjust if agents consistently hit limits or finish early.

2. **Subprocess resource contention (4 concurrent processes)**
   - What we know: Each `claude -p` subprocess makes API calls to Anthropic. 4 concurrent calls should be fine for API rate limits.
   - What's unclear: Local system resource impact (memory, CPU) of 4 concurrent Claude CLI processes.
   - Recommendation: Not a concern for most systems. Claude CLI is I/O-bound (waiting for API), not CPU-bound. No throttling needed.

3. **Dedup similarity threshold tuning**
   - What we know: Same file + overlapping lines + similar description is the match rule.
   - What's unclear: Optimal Levenshtein similarity threshold (0.5? 0.6? 0.7?) and line proximity window (2? 3? 5?).
   - Recommendation: Start with 0.6 similarity threshold and 3-line proximity window. These are discretionary (per CONTEXT.md). Can tune based on manual testing. Err on the side of NOT deduplicating (show both) rather than over-deduplicating (losing findings).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest v4.0.18 |
| Config file | Implicit (vitest resolves from package.json `"test": "vitest run"`) |
| Quick run command | `npx vitest run tests/orchestrator.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNTH-02 | `aspect` field optional in ReviewFindingSchema | unit | `npx vitest run tests/schemas.test.ts -t "aspect"` | No -- schemas have no dedicated test file (tested indirectly via analyzer.test.ts) |
| ORCH-06 | Aspect-specific prompt overlays exist and are domain-scoped | unit | `npx vitest run tests/prompt.test.ts -t "aspect"` | Partially (prompt.test.ts exists, needs new tests) |
| ORCH-01 | 4 concurrent subprocess calls via Promise.allSettled | unit | `npx vitest run tests/orchestrator.test.ts -t "team"` | No -- Wave 0 |
| ORCH-02 | Partial failure: 3 succeed when 1 fails | unit | `npx vitest run tests/orchestrator.test.ts -t "partial"` | No -- Wave 0 |
| ORCH-03 | Quick mode fan-out | unit | `npx vitest run tests/orchestrator.test.ts -t "quick"` | No -- Wave 0 |
| ORCH-04 | Deep mode fan-out | unit | `npx vitest run tests/orchestrator.test.ts -t "deep"` | No -- Wave 0 |
| ORCH-05 | --no-team single-agent mode | unit | `npx vitest run tests/cli.test.ts -t "no-team"` | No -- cli.ts has no test file currently |
| SYNTH-01 | Deduplication: same file+line+desc collapses | unit | `npx vitest run tests/orchestrator.test.ts -t "dedup"` | No -- Wave 0 |
| SYNTH-03 | Merged findings array with aspect tags | unit | `npx vitest run tests/orchestrator.test.ts -t "merge"` | No -- Wave 0 |
| SEC-01 | filterEnv strips ANTHROPIC_BASE_URL | unit | `npx vitest run tests/security.test.ts -t "ANTHROPIC_BASE_URL"` | Partially (security.test.ts exists, needs new test) |
| SEC-02 | scrubSecrets applied to all agent outputs | static analysis | `npx vitest run tests/security.test.ts -t "scrub"` | Partially (security.test.ts exists, pattern already verified) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/orchestrator.test.ts` (new file) + `npm test` (full suite for regression)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/orchestrator.test.ts` -- covers ORCH-01, ORCH-02, ORCH-03, ORCH-04, SYNTH-01, SYNTH-03
- [ ] New tests in `tests/prompt.test.ts` -- covers ORCH-06 (aspect overlay tests)
- [ ] New test in `tests/security.test.ts` -- covers SEC-01 (ANTHROPIC_BASE_URL filtering)
- [ ] Existing `tests/analyzer.test.ts` -- verify no regressions from schema change (SYNTH-02)
- [ ] Framework install: Not needed -- Vitest already configured

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/analyzer.ts`, `src/prompt.ts`, `src/schemas.ts`, `src/cli.ts`, `src/errors.ts`, `src/types.ts`, `src/output.ts` -- direct code inspection
- Existing tests: `tests/analyzer.test.ts`, `tests/prompt.test.ts`, `tests/security.test.ts` -- testing patterns
- `SECURITY.md` -- security model and invariants
- `CLAUDE.md` -- project conventions and constraints
- `.planning/phases/01-orchestration-foundation/01-CONTEXT.md` -- locked implementation decisions
- `.planning/STATE.md` -- project decisions (DIY subprocesses vs agent teams)

### Secondary (MEDIUM confidence)
- [Commander.js negatable options example](https://github.com/tj/commander.js/blob/HEAD/examples/options-negatable.js) -- verified `--no-*` pattern
- [MDN Promise.allSettled()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled) -- API reference
- [Levenshtein distance implementations](https://www.30secondsofcode.org/js/s/levenshtein-distance/) -- algorithm reference
- [Commander.js npm](https://www.npmjs.com/package/commander) -- negatable option documentation

### Tertiary (LOW confidence)
- None -- all findings verified against primary or secondary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all patterns verified in existing codebase
- Architecture: HIGH -- follows established patterns (overlay composition, module separation, Zod schema extension)
- Pitfalls: HIGH -- identified from direct code inspection of existing subprocess handling, timeout management, and security model
- Deduplication: MEDIUM -- algorithm is sound but threshold values (0.6 similarity, 3-line proximity) need validation through manual testing

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable -- no rapidly changing dependencies)

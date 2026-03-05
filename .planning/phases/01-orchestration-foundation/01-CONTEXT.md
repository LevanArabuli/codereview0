# Phase 1: Orchestration Foundation - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the parallel orchestration engine: add optional `aspect` field to `ReviewFinding` schema, create 4 expert-scoped prompt templates, implement fan-out via `Promise.allSettled()` with 4 concurrent `claude -p` subprocesses, deduplicate merged findings, add `--no-team` flag for graceful single-agent fallback, and extend `filterEnv()` to strip `ANTHROPIC_BASE_URL`. Output formatting (grouped sections, progress indicators) is Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Aspect scope boundaries
- Each aspect agent reports ONLY findings in its domain -- strict separation (security agent ignores non-security issues, etc.)
- All 4 agents receive the full PR diff (no per-aspect file filtering)
- In deep mode (cloned repo), all 4 aspect agents run as agentic sessions with codebase access
- Prompt design: shared base prompt (existing structure) + aspect-specific overlay per domain (similar to how review mode overlays work today)

### Deduplication behavior
- Deduplicate to a single finding; tag with the primary aspect (whichever agent's domain is most natural for that issue)
- Match rule: same file + overlapping lines (within a few lines) + semantically similar description
- Winner selection: higher severity wins when two aspects surface the same issue
- Dedup stats shown in `--verbose` mode (e.g., "12 raw findings, 9 after dedup") -- consistent with existing verbose debug output pattern

### Partial failure visibility
- Explicit per-aspect status shown to user (e.g., "Security: done, Performance: done, Quality: failed (timeout), Tests: done")
- Exit code 0 with warnings when some aspects fail but others succeed -- partial success is still success
- If ALL 4 aspect agents fail, auto-fallback to single-agent generalist review (consistent with existing deep-to-quick fallback pattern)
- Same timeout per aspect as current single-agent: 5 min (quick mode) / 10 min (deep mode). Since they run in parallel, total wall time stays similar.

### Review mode interaction
- Same review mode overlay (strict/detailed/lenient/balanced) applied to all 4 aspect agents
- All 4 aspects run in every mode -- no aspect suppression based on mode
- Aspect labels are separate from severity: `aspect: 'security' | 'performance' | 'quality' | 'tests'`. The 'security' collision with severity 'security' is accepted (aspect = who found it, severity = how bad it is)
- Team mode (4 parallel agents) is the DEFAULT behavior. `--no-team` opts out to single-agent.

### Claude's Discretion
- Exact dedup matching algorithm (string similarity threshold, line proximity window)
- Aspect overlay prompt wording -- as long as each is expert-scoped and domain-specific
- How the auto-fallback to generalist is triggered (all-fail detection logic)
- Per-aspect max-turns setting

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `filterEnv()` in `analyzer.ts`: Environment filtering for subprocess security -- extend with `ANTHROPIC_BASE_URL`
- `buildPrompt()` / `buildAgenticPrompt()` in `prompt.ts`: Base prompt builders -- reuse as foundation, add aspect overlay
- `MODE_OVERLAYS` pattern in `prompt.ts`: Existing overlay mechanism (Record<Mode, string>) -- same pattern works for aspect overlays
- `FINDING_FORMAT_INSTRUCTIONS` / `JSON_RESPONSE_INSTRUCTION` in `prompt.ts`: Shared format blocks -- reuse across all aspect prompts
- `ReviewFindingSchema` in `schemas.ts`: Zod schema -- add optional `aspect` field
- `parseClaudeResponse()` in `analyzer.ts`: Response parser -- reuse per-agent, stamp `aspect` field after parsing
- `scrubSecrets()` in `errors.ts`: Credential scrubbing -- apply to all 4 agent outputs

### Established Patterns
- `execFile` with argument arrays for subprocess calls (security invariant, never `exec()`)
- Double JSON parse pattern (Claude CLI wrapper + result text) in `analyzeDiff()`
- Retry-once logic with `MAX_ATTEMPTS` in `analyzeDiff()` -- consider for per-aspect retries
- `spawn` + stream-json pattern in `analyzeAgentic()` for deep mode
- Progress reporting via `printProgress()` / `printProgressDone()` -- reuse for per-aspect status

### Integration Points
- `cli.ts` orchestration: Currently branches into quick (`analyzeDiff`) or deep (`analyzeAgentic`). New team orchestrator sits between CLI and individual analysis calls.
- `AnalysisResult` type: `{ findings, model, meta? }` -- team orchestrator produces same shape with merged findings
- `ReviewFinding[]` array: All downstream consumers (output, review-builder, html-report, formatter) receive this array -- adding optional `aspect` field is backwards-compatible

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 01-orchestration-foundation*
*Context gathered: 2026-03-05*

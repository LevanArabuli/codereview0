# Architecture

**Analysis Date:** 2026-03-05

## Pattern Overview

**Overall:** Layered command-line application with subprocess orchestration.

**Key Characteristics:**
- Single-pass orchestration in CLI layer that branches into quick or deep review paths
- Subprocess-driven analysis using Claude Code CLI as the core engine
- GitHub API integration for PR data fetching and review posting
- Optional repository cloning for deep (agentic) analysis
- Modular separation of concerns: parsing, fetching, analyzing, formatting, posting

## Layers

**CLI / Orchestration (`cli.ts`):**
- Purpose: Main command handler, flow control (quick/deep branches), progress reporting, cleanup
- Location: `src/cli.ts`
- Contains: Commander setup, flag parsing, lifecycle management (fetch → analyze → post), error handling with exit codes
- Depends on: All other modules (github, analyzer, cloner, output, prompt, etc.)
- Used by: Entry point for `codereview` CLI command

**Data Fetching (`github.ts`):**
- Purpose: GitHub API integration via Octokit; authentication via gh CLI
- Location: `src/github.ts`
- Contains: `createOctokit()`, `fetchPRData()`, `postReview()`
- Depends on: @octokit/rest, gh CLI subprocess, types.ts
- Used by: cli.ts (fetch PR metadata, post review back to GitHub)

**Repository Management (`cloner.ts`):**
- Purpose: Safe repository cloning for deep review; input validation; directory lifecycle
- Location: `src/cloner.ts`
- Contains: `validateGitArg()`, `getClonePath()`, `cloneRepo()`, `promptCleanup()`
- Depends on: gh CLI subprocess, Node fs/path APIs
- Used by: cli.ts (deep mode only)

**Analysis Engine (`analyzer.ts`):**
- Purpose: Claude CLI invocation (quick and agentic modes); JSON response parsing and validation
- Location: `src/analyzer.ts`
- Contains: `analyzeDiff()` (quick mode), `analyzeAgentic()` (deep mode), environment filtering for security
- Depends on: Node child_process, Zod validation (schemas.ts), prompt.ts
- Used by: cli.ts (both quick and deep paths)

**Prompt Construction (`prompt.ts`):**
- Purpose: Build review prompts with mode overlays and finding format specifications
- Location: `src/prompt.ts`
- Contains: `buildPrompt()` (quick mode), `buildAgenticPrompt()` (deep mode), mode overlays (strict/detailed/lenient/balanced)
- Depends on: types.ts
- Used by: analyzer.ts (passed to Claude CLI as `-p` argument)

**Finding Routing (`review-builder.ts`):**
- Purpose: Partition findings into inline (in diff hunks) vs. off-diff for GitHub posting
- Location: `src/review-builder.ts`
- Contains: `partitionFindings()`, `buildReviewBody()`
- Depends on: types.ts, schemas.ts, diff-parser.ts, formatter.ts
- Used by: cli.ts (post-analysis phase)

**Diff Parsing (`diff-parser.ts`):**
- Purpose: Parse unified diff format; determine which lines are modified
- Location: `src/diff-parser.ts`
- Contains: `parseDiffHunks()`, `isLineInDiff()`, regex patterns for diff headers and hunks
- Depends on: types.ts
- Used by: review-builder.ts, html-report.ts (finding routing and HTML generation)

**HTML Report Generation (`html-report.ts`, `html-diff-parser.ts`):**
- Purpose: Standalone HTML report with inline annotations and off-diff sections
- Location: `src/html-report.ts`, `src/html-diff-parser.ts`
- Contains: `generateHtmlReport()`, `openInBrowser()`, detailed diff parsing for rendering
- Depends on: types.ts, schemas.ts, review-builder.ts, diff-parser.ts, formatter.ts
- Used by: cli.ts (--html flag)

**Terminal Output (`output.ts`):**
- Purpose: Formatted terminal printing with color and progress indicators
- Location: `src/output.ts`
- Contains: `printPRSummary()`, `printFindings()`, `printProgress()`, `printDebug()`, `printModel()`, timing utilities
- Depends on: picocolors (color library), types.ts, schemas.ts
- Used by: cli.ts (all reporting phases)

**GitHub Comment Formatting (`formatter.ts`):**
- Purpose: Format individual findings as GitHub inline comments
- Location: `src/formatter.ts`
- Contains: `formatInlineComment()`, `capitalizeSeverity()`
- Depends on: schemas.ts
- Used by: cli.ts (posting inline comments to GitHub)

**Error Handling & Security (`errors.ts`):**
- Purpose: Error classification, credential scrubbing, exit codes
- Location: `src/errors.ts`
- Contains: `scrubSecrets()`, `sanitizeError()`, exit code constants (EXIT_PREREQ, EXIT_INVALID_URL, EXIT_API_ERROR, EXIT_ANALYSIS_ERROR)
- Depends on: None
- Used by: cli.ts, all error paths

**Schema Validation (`schemas.ts`):**
- Purpose: Zod schemas for Claude CLI response validation
- Location: `src/schemas.ts`
- Contains: `ReviewFindingSchema`, `ReviewResultSchema`, TypeScript type derivations
- Depends on: zod
- Used by: analyzer.ts (parse and validate Claude CLI JSON response)

**Type Definitions (`types.ts`):**
- Purpose: Shared TypeScript interfaces across modules
- Location: `src/types.ts`
- Contains: `ParsedPR`, `PRData`, `PRFile`, `DiffHunk`, `PrereqFailure`
- Depends on: None
- Used by: All modules

**URL Parsing (`url-parser.ts`):**
- Purpose: Parse GitHub PR URL into owner/repo/prNumber
- Location: `src/url-parser.ts`
- Contains: `parsePRUrl()`
- Depends on: types.ts
- Used by: cli.ts (argument validation)

**Prerequisite Checking (`prerequisites.ts`):**
- Purpose: Verify required CLI tools (gh, claude) are installed and authenticated
- Location: `src/prerequisites.ts`
- Contains: `checkPrerequisites()`
- Depends on: types.ts
- Used by: cli.ts (early validation before any API calls)

**Evaluation & Testing (`eval.ts`):**
- Purpose: Infrastructure for fixture-based testing of review quality
- Location: `src/eval.ts`
- Contains: Test utilities, evaluation harness
- Depends on: Varies by test usage
- Used by: tests/eval.test.ts

## Data Flow

**Quick Mode (Default):**

1. **Parse & Validate**: CLI parses PR URL and flags
2. **Check Prerequisites**: Verify gh and claude CLIs present
3. **Fetch PR Data**: `github.ts` uses Octokit to fetch PR metadata, files, diff
4. **Build Prompt**: `prompt.ts` constructs review prompt with mode overlay
5. **Analyze Diff**: `analyzer.ts` invokes Claude CLI (`claude -p`) with prompt
6. **Parse Response**: Double JSON parse (Claude wrapper + findings), Zod validation
7. **Terminal Output**: `output.ts` displays PR summary and findings
8. **Route Findings**: `review-builder.ts` partitions findings (inline vs. off-diff)
9. **Optional: Post Review**: If `--post` flag set, post to GitHub via `github.ts`
10. **Optional: HTML Report**: If `--html` flag set, generate and open report

**Deep Mode (with --deep flag):**

1. **Parse & Validate**: CLI parses PR URL and flags
2. **Check Prerequisites**: Verify gh and claude CLIs present
3. **Fetch PR Data**: Same as quick mode
4. **Clone Repository**: `cloner.ts` runs `gh repo clone` with validation; sets permissions 0o700; removes origin remote
5. **Build Agentic Prompt**: `prompt.ts` constructs unified prompt for full codebase exploration
6. **Analyze (Agentic)**: `analyzer.ts` invokes Claude CLI with `--output-format stream-json` and spawned subprocess
   - Streams stderr (exploration output) to terminal in real-time
   - Accumulates stdout for JSON parsing
   - Enforces 10-minute timeout, max 75 turns
7. **Parse Response**: Same as quick mode
8. **Terminal Output**: Display findings
9. **Route & Post**: Same as quick mode
10. **Cleanup**: Prompt user to keep or delete cloned repo; cleanup on SIGINT/error via try-finally

**Fallback Behavior (Deep → Quick):**

If cloning fails in deep mode, CLI automatically falls back to quick mode analysis with the diff alone.

## Key Abstractions

**ReviewFinding:**
- Purpose: A single code review issue with location, severity, confidence, and description
- Examples: `src/schemas.ts`, `src/types.ts`
- Pattern: Zod-validated JSON structure with optional fields (endLine, suggestedFix, relatedLocations)

**PRData:**
- Purpose: Complete pull request information fetched from GitHub API
- Examples: `src/types.ts`
- Pattern: Aggregates PR metadata, file list, and unified diff into single object

**AnalysisResult:**
- Purpose: Structured output from Claude CLI analysis
- Examples: `src/analyzer.ts`
- Pattern: Contains findings array, model ID, and optional operational metadata (cost, duration)

**DiffHunk:**
- Purpose: A range within a file where changes occur (for inline comment validation)
- Examples: `src/types.ts`
- Pattern: Tracks newStart and newCount to determine if a line is in the modified region

**ReviewMode:**
- Purpose: Enum-like type for review scope control (strict/detailed/lenient/balanced)
- Examples: `src/prompt.ts`
- Pattern: Union type applied as prompt overlay to control finding severity filtering

## Entry Points

**CLI Command (`src/cli.ts`):**
- Location: `src/cli.ts` (line 105-279)
- Triggers: `npm run dev` or `npx tsx src/cli.ts` (dev); `codereview` command (built)
- Responsibilities: Parse command-line arguments, orchestrate workflow, manage lifecycles, handle errors

**Binary Entrypoint (`dist/cli.js`):**
- Location: Built to `dist/cli.js` by tsup
- Triggers: `codereview <pr-url>` command (installed globally or via npm)
- Responsibilities: Same as above

## Error Handling

**Strategy:** Collect failures early, report comprehensively, scrub all sensitive data.

**Patterns:**

1. **Prerequisite Collection**: `prerequisites.ts` collects all failures (gh, gh auth, claude), returns array, displays all at once with help text
2. **Input Validation**: URL parsing and git argument validation reject upfront with clear messages
3. **API Error Wrapping**: GitHub API errors caught, sanitized, and converted to meaningful messages
4. **Analysis Error Recovery**: If analysis fails, error message is scrubbed and printed; user sees structured output
5. **Cleanup Safety**: Clone directory cleanup is wrapped in try-finally and SIGINT handler to ensure best-effort removal
6. **Credential Scrubbing**: All error messages and verbose output pass through `scrubSecrets()` which replaces GitHub tokens (ghp_*, gho_*, ghs_*, ghr_*, ghu_*, github_pat_*), Anthropic keys (sk-ant-*), Bearer tokens, and URL-embedded credentials with [REDACTED]

**Exit Codes:**
- `0`: Success
- `1` (EXIT_PREREQ): Prerequisites failed (gh/claude not installed or gh not authenticated)
- `2` (EXIT_INVALID_URL): PR URL is malformed
- `3` (EXIT_API_ERROR): GitHub API call failed
- `4` (EXIT_ANALYSIS_ERROR): Analysis invocation or response parsing failed

## Cross-Cutting Concerns

**Logging:**
- Progress indicators: `printProgress()` without newline, completed with `printProgressDone()`
- Debug info (--verbose only): Timing (fetch/clone/analyze), token counts, metadata
- Model ID: Always printed after analysis
- Finding counts: Printed if --verbose and --post; distinguishes raw vs. posted counts

**Validation:**
- Git arguments (`owner`, `repo`, `branch`): `validateGitArg()` rejects leading dash, path traversal, null bytes
- PR URLs: `parsePRUrl()` regex-based parsing
- JSON responses: `parseClaudeResponse()` attempts direct parse, falls back to regex extraction, validates with Zod
- Finding fields: Zod schema ensures required fields, optional fields, and enum values

**Authentication:**
- GitHub: Obtained from `gh auth token` and cached in Octokit instance
- Claude API: Passed via ANTHROPIC_API_KEY env var (preserved by `filterEnv()`)

**Environment Filtering (Security):**
- Claude CLI subprocess receives filtered `process.env` via `filterEnv()`
- Blocklist approach: Strips vars matching dangerous prefixes (AWS_, AZURE_, GCP_, DATABASE_, SECRET_, CI_, etc.)
- Whitelist: Keeps ANTHROPIC_API_KEY, GH_TOKEN, GITHUB_TOKEN
- Purpose: Prevent credential leakage to untrusted code execution environment

---

*Architecture analysis: 2026-03-05*

# Architecture

**Analysis Date:** 2026-03-04

## Pattern Overview

**Overall:** Pipeline CLI — single-entry orchestrator invoking a sequential pipeline of focused modules

**Key Characteristics:**
- No framework or server: pure Node.js CLI tool with no runtime HTTP server
- One-way data flow: URL in → PR data → prompt → Claude subprocess → structured findings → output/post
- Flat module graph: all 17 modules are siblings under `src/`; no nested layers or barrel files
- Two review modes (quick/deep) share the same post-analysis pipeline via `handlePostAnalysis()`
- Security enforcement is cross-cutting: every subprocess call uses `execFile` with argument arrays, every error path scrubs credentials via `scrubSecrets()`

## Layers

**Orchestration:**
- Purpose: Parse CLI flags, sequence the pipeline, handle errors and exit codes
- Location: `src/cli.ts`
- Contains: Commander setup, flow control for quick vs. deep modes, SIGINT handler, clone cleanup
- Depends on: all other modules
- Used by: nothing (entry point)

**Input / Validation:**
- Purpose: Parse and validate untrusted inputs before any downstream use
- Location: `src/url-parser.ts`, `src/prerequisites.ts`, `src/cloner.ts` (`validateGitArg`, `getClonePath`)
- Contains: URL regex parsing, CLI prerequisite checks, git argument sanitization
- Depends on: `src/types.ts`
- Used by: `src/cli.ts`

**Data Fetching:**
- Purpose: Authenticate with GitHub and retrieve PR metadata, file list, and unified diff
- Location: `src/github.ts`
- Contains: `createOctokit()`, `fetchPRData()`, `postReview()`
- Depends on: `@octokit/rest`, `src/types.ts`
- Used by: `src/cli.ts`

**Repository Cloning:**
- Purpose: Shallow-clone a PR branch for deep (agentic) review mode
- Location: `src/cloner.ts`
- Contains: `cloneRepo()`, `getClonePath()`, `validateGitArg()`, `promptCleanup()`
- Depends on: Node built-ins (`child_process`, `fs`, `path`, `readline`)
- Used by: `src/cli.ts` (deep mode only)

**Prompt Construction:**
- Purpose: Build structured text prompts for Claude; defines `ReviewMode` type and mode overlays
- Location: `src/prompt.ts`
- Contains: `buildPrompt()` (quick), `buildAgenticPrompt()` (deep), `getModeOverlay()`, diff truncation
- Depends on: `src/types.ts`
- Used by: `src/analyzer.ts`

**AI Analysis:**
- Purpose: Invoke Claude CLI as subprocess and parse structured `ReviewFinding[]` from output
- Location: `src/analyzer.ts`
- Contains: `analyzeDiff()` (execFile, quick), `analyzeAgentic()` (spawn, streaming, deep), `filterEnv()`, response parsing with retry, Zod validation
- Depends on: `src/schemas.ts`, `src/prompt.ts`, `src/types.ts`, `src/errors.ts`
- Used by: `src/cli.ts`

**Output Rendering:**
- Purpose: Format findings and metadata for terminal display; generate HTML reports
- Location: `src/output.ts`, `src/html-report.ts`, `src/html-diff-parser.ts`
- Contains: `printFindings()` (severity-sorted), `printAnalysisSummary()`, `generateHtmlReport()`, detailed diff parsing for HTML
- Depends on: `picocolors`, `src/schemas.ts`, `src/types.ts`, `src/review-builder.ts`, `src/formatter.ts`, `src/diff-parser.ts`
- Used by: `src/cli.ts`

**GitHub Review Posting:**
- Purpose: Map findings to GitHub inline comments or review body; post PENDING review
- Location: `src/review-builder.ts`, `src/formatter.ts`, `src/diff-parser.ts`
- Contains: `partitionFindings()`, `buildReviewBody()`, `formatInlineComment()`, `parseDiffHunks()`, `isLineInDiff()`
- Depends on: `src/types.ts`, `src/schemas.ts`
- Used by: `src/cli.ts` (via `handlePostAnalysis`)

**Schemas / Types:**
- Purpose: Shared type definitions and Zod validation schemas used across modules
- Location: `src/schemas.ts`, `src/types.ts`
- Contains: `ReviewFindingSchema`, `ReviewResultSchema`, `PRData`, `ParsedPR`, `DiffHunk`, `PRFile`, `PrereqFailure`
- Depends on: `zod`
- Used by: most modules

**Error Handling / Security:**
- Purpose: Exit codes, credential scrubbing, error sanitization — cross-cutting concerns
- Location: `src/errors.ts`
- Contains: `scrubSecrets()`, `sanitizeError()`, `EXIT_PREREQ / EXIT_INVALID_URL / EXIT_API_ERROR / EXIT_ANALYSIS_ERROR`
- Depends on: nothing
- Used by: `src/cli.ts`, `src/analyzer.ts`

**Evaluation Infrastructure:**
- Purpose: Fixture-based quality measurement of review output (precision/recall)
- Location: `src/eval.ts`
- Contains: `matchFindings()`, `computeMetrics()` — not invoked at runtime, only used by `tests/eval.test.ts`
- Depends on: `src/schemas.ts`
- Used by: `tests/eval.test.ts`

## Data Flow

**Quick Review Flow:**

1. `cli.ts`: Parse URL with `parsePRUrl()` → `ParsedPR`
2. `cli.ts`: Call `checkPrerequisites()` — fail-fast if `gh` or `claude` missing
3. `github.ts`: `fetchPRData()` — three parallel Octokit calls → `PRData`
4. `prompt.ts`: `buildPrompt(prData, mode)` → prompt string with embedded diff
5. `analyzer.ts`: `analyzeDiff()` — `execFile('claude', ['-p', prompt, '--output-format', 'json'])` → `AnalysisResult`
6. `schemas.ts`: Zod validation of `wrapper.result` → `ReviewFinding[]`
7. `output.ts`: `printAnalysisSummary()` + `printFindings()` (sorted by severity)
8. *(optional)* `html-report.ts`: `generateHtmlReport()` + `openInBrowser()`
9. *(optional, `--post`)* `diff-parser.ts` + `review-builder.ts` + `formatter.ts` + `github.ts`: partition findings → inline comments → `postReview()`

**Deep Review Flow:**

1–3. Same as quick review
4. `cloner.ts`: `cloneRepo()` — `gh repo clone` + `git remote remove origin`
5. `prompt.ts`: `buildAgenticPrompt(prData, mode)` → agentic prompt with changed file list
6. `analyzer.ts`: `analyzeAgentic()` — `spawn('claude', [..., '--output-format', 'stream-json'])` in `clonePath` CWD; streams stderr to terminal; parses final `result` event
7–9. Same as quick review steps 6–9
10. `cloner.ts`: `promptCleanup()` — user prompted to keep or delete clone

**State Management:**
- Stateless between runs — no database, no file-based cache
- Single mutable global: `activeClonePath` in `cli.ts` for SIGINT-safe cleanup
- All data flows through function parameters; no shared module-level state in business logic

## Key Abstractions

**ReviewFinding:**
- Purpose: The core data unit — a single code review issue with location, severity, confidence, and description
- Examples: `src/schemas.ts` (Zod schema + TypeScript type), consumed by `src/output.ts`, `src/formatter.ts`, `src/review-builder.ts`, `src/html-report.ts`
- Pattern: Defined once via Zod in `schemas.ts`, exported as both `ReviewFindingSchema` and `type ReviewFinding`

**PRData:**
- Purpose: All PR information from GitHub — metadata, file list, and raw unified diff
- Examples: `src/types.ts` (interface definition), produced by `src/github.ts`, consumed by `src/prompt.ts`, `src/cli.ts`, `src/html-report.ts`
- Pattern: Plain TypeScript interface (no Zod — GitHub API responses are trusted upstream)

**ReviewMode:**
- Purpose: Controls review thoroughness — `'strict' | 'detailed' | 'lenient' | 'balanced'`
- Examples: `src/prompt.ts` (definition and `MODE_OVERLAYS`), threaded through `cli.ts` → `analyzer.ts` → `prompt.ts`
- Pattern: `as const` array + `typeof` derived union type

**AnalysisResult:**
- Purpose: Return type from both `analyzeDiff()` and `analyzeAgentic()` — findings + model ID + optional meta
- Examples: `src/analyzer.ts`
- Pattern: Internal interface (not exported from module)

**DiffHunk:**
- Purpose: A new-file-side hunk range from a unified diff, used to determine if a finding line is postable as inline comment
- Examples: `src/types.ts` (interface), produced by `src/diff-parser.ts`, consumed by `src/review-builder.ts` and `src/html-report.ts`
- Pattern: Plain interface, stored in `Map<string, DiffHunk[]>` keyed by filename

## Entry Points

**CLI Entry Point:**
- Location: `src/cli.ts`
- Triggers: `node dist/cli.js <pr-url> [flags]` or `npx tsx src/cli.ts <pr-url>`
- Responsibilities: Commander setup, flag parsing, sequential pipeline orchestration, exit code management, SIGINT cleanup

**Build Output:**
- Location: `dist/cli.js` (single bundled ESM file with shebang)
- Triggers: Called when installed as `codereview` binary via `package.json` `bin` field

## Error Handling

**Strategy:** Fail-fast with specific exit codes; catch-and-scrub at all boundary points; no panic propagation

**Patterns:**
- Prerequisite failures: collected into `PrereqFailure[]` array (not fail-fast per check), printed together, then `process.exit(EXIT_PREREQ)` — code 1
- URL parse failure: `process.exit(EXIT_INVALID_URL)` — code 2
- GitHub API failure: catch → `sanitizeError(error)` → `process.exit(EXIT_API_ERROR)` — code 3
- Analysis failure: catch → `sanitizeError(error)` → `process.exit(EXIT_ANALYSIS_ERROR)` — code 4
- Clone failure: caught, warning printed, falls back to quick review (non-fatal)
- Post review failure: caught, warning printed, tool continues (non-fatal)
- SIGINT: `process.on('SIGINT')` handler triggers `cleanupOnExit()` + `process.exit(130)`
- Clone cleanup safety net: `try/finally` in deep mode wraps entire clone+analysis+post flow

## Cross-Cutting Concerns

**Credential Scrubbing:** All error messages pass through `sanitizeError()` from `src/errors.ts`; all Claude CLI stderr output passes through `scrubSecrets()` before reaching the terminal. No escape hatch in `--verbose` mode.

**Subprocess Security:** Every subprocess call (`execFile`, `execFileSync`, `spawn`) uses argument arrays. No `exec()` with string interpolation exists anywhere. All GitHub API values used in subprocess args pass through `validateGitArg()` from `src/cloner.ts` first.

**Environment Filtering:** `filterEnv()` in `src/analyzer.ts` strips known-dangerous env var prefixes before passing env to the Claude CLI subprocess (blocklist approach).

**TypeScript Strictness:** `strict: true` in `tsconfig.json`; all modules use ESM imports with `.js` extensions (NodeNext resolution).

---

*Architecture analysis: 2026-03-04*

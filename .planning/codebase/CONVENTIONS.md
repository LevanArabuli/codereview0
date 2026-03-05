# Coding Conventions

**Analysis Date:** 2026-03-05

## Naming Patterns

**Files:**
- kebab-case for all source files: `analyzer.ts`, `cloner.ts`, `diff-parser.ts`, `html-report.ts`, `url-parser.ts`
- Test files: `{module-name}.test.ts` (e.g., `analyzer.test.ts`, `cloner.test.ts`)
- Config files: kebab-case or dot-notation: `vitest.config.ts`, `tsconfig.json`, `tsup.config.ts`

**Functions:**
- camelCase for all function names: `parsePRUrl()`, `validateGitArg()`, `sanitizeError()`, `printPRSummary()`, `formatDuration()`
- Private/internal helpers may use camelCase prefix with underscore pattern (rare): see `filterEnv()` in `src/analyzer.ts`
- Export functions explicitly named: `export function analyzeDiff()`, `export async function cloneRepo()`

**Variables:**
- camelCase for all local and module-level variables: `mockPR`, `activeClonePath`, `mockExecFile`, `findings`, `prData`
- CONSTANT_CASE for compile-time constants and configuration values: `MAX_DIFF_CHARS`, `ANALYSIS_TIMEOUT_MS`, `MAX_BUFFER`, `MAX_ATTEMPTS`, `DANGEROUS_PREFIXES`, `REVIEW_MODES`, `FILE_HEADER_RE`, `HUNK_HEADER_RE`
- Semantic naming: `const activeClonePath: string | null = null;` tracks live state, not `cp` or `path`

**Types:**
- PascalCase for all TypeScript types and interfaces: `PRData`, `ParsedPR`, `ReviewFinding`, `PrereqFailure`, `DiffHunk`, `PRFile`, `ReviewMode`, `AnalysisMeta`, `ClaudeResponse`
- Type imports explicit: `import type { PRData, ParsedPR } from './types.js'` (separate from value imports)
- Schema types derived from Zod: `ReviewFinding = z.infer<typeof ReviewFindingSchema>`

**Record/Object Literals:**
- camelCase keys: `{ total_cost_usd: 0.0423, is_error: false, duration_ms: 45200 }` (matches external API response format)
- Mode overlay record uses camelCase keys: `MODE_OVERLAYS[mode]`

## Code Style

**Formatting:**
- Prettier not enforced (no `.prettierrc` file exists)
- Manual formatting observed: consistent 2-space indentation, trailing commas in objects/arrays
- Line breaks: blank lines separate function groups, logical blocks within functions

**Linting:**
- No eslint or other linter (explicitly documented in CLAUDE.md as omitted)
- TypeScript strict mode is the linting mechanism: `"strict": true` in `tsconfig.json`
- Type checking via `npm run lint` which runs `tsc --noEmit`

**Spacing & Indentation:**
- 2-space indentation throughout (standard Node convention)
- No trailing commas in function parameters, trailing commas in objects/arrays
- Blank lines before comments that document sections: `// ─── INP: Input Validation ───`
- Function spacing: blank line after function declaration, before next statement

**Parentheses & Operators:**
- Spaces around operators: `const result = diff.length <= MAX_DIFF_CHARS`
- No space after function names in calls: `printPRSummary(prData)` not `printPRSummary (prData)`
- Destructuring uses clear spacing: `const { verbose, post, html } = options`

## Import Organization

**Order:**
1. Node built-in modules: `import { execFile } from 'node:child_process'`
2. Third-party dependencies: `import { Command } from 'commander'`, `import pc from 'picocolors'`
3. Local modules: `import { parsePRUrl } from './url-parser.js'`
4. Type imports (separate): `import type { PRData } from './types.js'`

**Pattern:**
- All imports use explicit relative paths with `.js` extension (ESM, `"type": "module"`)
- No wildcard imports except `import * as path` (namespace import for module-like APIs)
- Type imports grouped separately after value imports

**Path Aliases:**
- Not used. All paths are relative: `'./analyzer.js'`, `'../src/types.js'`
- tsconfig has no `paths` configuration

**Example from `src/cli.ts`:**
```typescript
import { Command, Option } from 'commander';
import pc from 'picocolors';
import { parsePRUrl } from './url-parser.js';
import { checkPrerequisites } from './prerequisites.js';
import { createOctokit, fetchPRData, postReview } from './github.js';
import { printPRSummary, printErrors, ... } from './output.js';
import { buildPrompt, type ReviewMode } from './prompt.js';
import type { PRData, ParsedPR } from './types.js';
```

## Error Handling

**Patterns:**

**Custom Error Classes:**
All errors are instances of `Error` or thrown with string messages. Custom error classes not used. Example from `src/errors.ts`:

```typescript
function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return scrubSecrets(message);
}
```

**Try/Catch Pattern:**
- Always catches `error: unknown` (strict typing)
- Always calls `sanitizeError()` before logging/displaying (security invariant: credential scrubbing)
- Three-phase error handling in CLI (`src/cli.ts`):
  1. Prerequisites check, collect all failures, report together
  2. Parse and fetch phase with try/catch per operation
  3. Analysis phase with try/catch and fallback behavior

**Example from `src/cli.ts` (lines 143-152):**
```typescript
try {
  printProgress('Fetching PR data...');
  prData = await fetchPRData(octokit, parsed.owner, parsed.repo, parsed.prNumber);
  printProgressDone();
} catch (error: unknown) {
  console.log(); // newline after progress message
  console.error(pc.red('\u2716 Failed to fetch PR data'));
  console.error(pc.dim('  ' + sanitizeError(error)));
  process.exit(EXIT_API_ERROR);
}
```

**Security Invariant:**
- All error messages pass through `scrubSecrets()` before display
- Pattern: `sanitizeError(error)` is called in every catch block
- No escape hatch for this rule, even in `--verbose` mode

**Subprocess Error Handling:**
- `execFile` errors are caught and scrubbed
- Timeout errors result in retry logic (max 2 attempts)
- Parse failures (invalid JSON from Claude CLI) throw validation errors via Zod

## Logging

**Framework:** `console` (built-in only)

**Patterns:**

**Log Levels (via picocolors):**
- `console.log()` with color: `pc.bold()`, `pc.cyan()`, `pc.green()`, `pc.red()`, `pc.dim()`, `pc.yellow()`
- `console.error()` for errors: `console.error(pc.red('message'))`
- `process.stdout.write()` for progress without trailing newline

**When to Log:**

1. **Always visible:**
   - PR summary (title, metadata, file list) via `printPRSummary()`
   - Model name via `printModel()`
   - Review mode via `printMode()`
   - Analysis summary (severity counts) via `printAnalysisSummary()`
   - Finding list via `printFindings()` (sorted by severity)

2. **`--verbose` flag only:**
   - Timing info: `printDebug(\`Fetch: ${formatDuration(ms)}\`)`
   - Token estimates: `printDebug(\`Analyze: ..., prompt ${estimateTokens(length)}\`)`
   - Metadata (cost, duration, turns): `printMeta(meta)`
   - Finding counts: `printDebug(\`Findings: ${count} raw\`)`

3. **Error paths (always shown):**
   - Prerequisites failures: `printErrors(failures)` with help text
   - API errors: `console.error(pc.red(...))` with sanitized message
   - Analysis errors: same pattern

**Functions:**
- `printProgress(msg)`: write without newline (for "Fetching... done" pattern)
- `printProgressDone()`: complete the progress line with "done" in green
- `printDebug(msg)`: output as `[debug] message` in dim color
- `printErrors(failures)`: output with checkmark and help text
- `sanitizeError(error)`: convert unknown error to scrubbed string

**Example:**
```typescript
if (options.verbose) {
  printDebug(`Clone: ${formatDuration(cloneDuration)}`);
}
```

## Comments

**When to Comment:**

**JSDoc-style headers for exported functions:**
```typescript
/**
 * Parse a unified diff string and return a Map from filename to array of DiffHunk.
 * Each DiffHunk captures the new-file side range (newStart, newCount).
 */
export function parseDiffHunks(diff: string): Map<string, DiffHunk[]> {
```

**Inline comments for non-obvious behavior:**
```typescript
// Try to cut at the last complete file boundary (diff --git line)
const lastFileBoundary = truncated.lastIndexOf('\ndiff --git');
```

**Section markers for logical groupings:**
```typescript
// ─── INP: Input Validation ───────────────────────────────────────────────────
```

**What NOT to comment:**
- Self-explanatory code (type hints are sufficient)
- Modern TypeScript patterns (type signatures explain intent)
- Obvious implementations

## Function Design

**Size:** Typically 10-50 lines. Longer functions (100+ lines) only when orchestrating complex workflows (e.g., `cli.ts` main action handler)

**Parameters:**

- Named parameters preferred when 3+ arguments: use object destructuring
  ```typescript
  async function handlePostAnalysis(
    findings: ReviewFinding[],
    prData: PRData,
    parsed: ParsedPR,
    octokit: ReturnType<typeof createOctokit>,
    options: { verbose?: boolean; post?: boolean; html?: boolean },
  ): Promise<void> {
  ```
- Type annotations required (strict TypeScript)
- Union types for optional patterns: `PRData | null` not `PRData?`

**Return Values:**

- Async functions return `Promise<T>`: `async function cloneRepo(...): Promise<void>`
- Explicit return types required (no implicit `any`)
- Union returns when multiple success paths: not used; prefer explicit types
- Void return for side-effect-only functions: `function cleanupOnExit(): void`

**Error Handling:**
- All subprocess calls wrapped in try/catch with `unknown` type
- Validation errors via Zod (automatic parse failures throw)
- Network errors caught and re-thrown with context

**Side Effects:**
- Functions with side effects explicitly documented in comments:
  ```typescript
  /** Track active clone path for cleanup on error/SIGINT */
  let activeClonePath: string | null = null;

  /** Best-effort cleanup of active clone directory */
  function cleanupOnExit(): void {
  ```

## Module Design

**Exports:**

- Named exports only: `export function analyzeDiff()`, `export const REVIEW_MODES`
- Type exports grouped: `export type ReviewMode = ...`
- No default exports

**Module Purposes (from CLAUDE.md):**
Each module has single responsibility:
- `cli.ts`: Entry point, flag parsing, orchestration
- `analyzer.ts`: Subprocess invocation and response parsing
- `types.ts`: TypeScript type definitions only
- `schemas.ts`: Zod validation schemas
- `errors.ts`: Error constants and scrubbing utilities
- `output.ts`: Terminal formatting and printing
- `github.ts`: Octokit client and API interaction
- etc.

**Barrel Files:** Not used. All imports are direct path imports.

**Constants vs. Functions:**
- Constants that are configuration: `MAX_DIFF_CHARS`, `ANALYSIS_TIMEOUT_MS`, `DANGEROUS_PREFIXES`
- Constants that need computation: still const if simple, or named function if complex
  ```typescript
  function filterEnv(): NodeJS.ProcessEnv { // not const because it depends on process.env
  ```

**Module-Level State:**
- Minimal: `activeClonePath` in `cli.ts` for cleanup tracking
- All state either typed explicitly or inferred from assignment
- Process-level handlers registered once: `process.on('SIGINT', ...)`

## Security Patterns

**Subprocess Invocation (SUB-01):**
- Always use `execFile()` or `execFileSync()` with argument array: never `exec()`
- Example: `execFile('gh', ['repo', 'clone', 'owner/repo', path], options)`

**Input Validation (INP-01):**
- Untrusted inputs pass through `validateGitArg()` before subprocess use
- Validates against: leading dashes, path traversal (`..`), null bytes, empty values

**Environment Filtering (SUB-02):**
- Claude CLI subprocess receives filtered `process.env` via `filterEnv()`
- Strips prefixes: `AWS_`, `AZURE_`, `GCP_`, `DATABASE_`, `CI_`, `TOKEN_`, `SECRET_`, etc.
- Whitelist: `ANTHROPIC_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`

**Credential Scrubbing (CRED-01):**
- Pattern: `scrubSecrets(text)` replaces patterns with `[REDACTED]`
- Patterns: GitHub tokens (`ghp_*`, `gho_*`, etc.), API keys (`sk-ant-*`), Bearer auth, URL-embedded creds
- Applied to all error messages: `sanitizeError()` calls `scrubSecrets()`

---

*Convention analysis: 2026-03-05*

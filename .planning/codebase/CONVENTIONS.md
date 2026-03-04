# Coding Conventions

**Analysis Date:** 2026-03-04

## Naming Patterns

**Files:**
- `kebab-case` for all source files: `html-diff-parser.ts`, `review-builder.ts`, `url-parser.ts`
- Single word when unambiguous: `analyzer.ts`, `cloner.ts`, `formatter.ts`, `output.ts`, `prompt.ts`
- Each file maps directly to a single responsibility/module

**Functions:**
- `camelCase` for all functions: `parsePRUrl`, `buildPrompt`, `analyzeDiff`, `checkPrerequisites`
- Verb-first naming: `fetchPRData`, `formatDuration`, `validateGitArg`, `extractHeadline`
- Print-prefix for side-effectful terminal output functions: `printPRSummary`, `printDebug`, `printModel`, `printFindings`
- Build-prefix for construction functions: `buildPrompt`, `buildAgenticPrompt`, `buildReviewBody`
- Get-prefix for value retrieval: `getClonePath`, `getModeOverlay`, `getGitHubToken`

**Variables:**
- `camelCase` for all variables and parameters
- `SCREAMING_SNAKE_CASE` for module-level constants: `ANALYSIS_TIMEOUT_MS`, `MAX_BUFFER`, `MAX_AGENTIC_TURNS`, `DANGEROUS_PREFIXES`, `SEVERITY_ORDER`
- Numeric constants use underscore separators for readability: `300_000`, `60_000`, `80_000`, `10 * 1024 * 1024`

**Types and Interfaces:**
- `PascalCase` for interfaces and type aliases: `PRData`, `ParsedPR`, `PrereqFailure`, `ReviewFinding`, `AnalysisMeta`, `ClaudeResponse`
- Types derived from Zod schemas use `z.infer<typeof Schema>`: `ReviewFinding = z.infer<typeof ReviewFindingSchema>`
- Schema constants end in `Schema`: `ReviewFindingSchema`, `ReviewResultSchema`

**Exports:**
- Constants for exit codes use `EXIT_` prefix: `EXIT_PREREQ`, `EXIT_INVALID_URL`, `EXIT_API_ERROR`, `EXIT_ANALYSIS_ERROR` (in `src/errors.ts`)

## Code Style

**Formatting:**
- No Prettier or Biome configuration present — formatting is enforced through TypeScript strict mode and code review
- Consistent 2-space indentation throughout
- Single quotes for string literals in most files; some files use double quotes (noted inconsistency in `src/analyzer.ts` vs rest of codebase)
- Semicolons always present
- Trailing commas in multi-line arrays and objects

**Linting:**
- `tsc --noEmit` is the lint step (no ESLint) — TypeScript compiler is the sole static analysis tool
- `"strict": true` in `tsconfig.json` enables all strict checks
- `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`

## Import Organization

**Order (observed pattern):**
1. Node built-in modules with `node:` prefix: `import { execFile } from 'node:child_process'`
2. External packages: `import pc from 'picocolors'`, `import { z } from 'zod'`
3. Internal modules with `.js` extension: `import { parsePRUrl } from './url-parser.js'`
4. Type-only imports last within each group: `import type { PRData } from './types.js'`

**Path Aliases:**
- None — all internal imports use relative paths with explicit `.js` extensions (required by NodeNext module resolution)

**Node Built-in Prefix:**
- Always use `node:` prefix for built-ins: `node:child_process`, `node:fs`, `node:path`, `node:util`
- Never use bare `child_process`, `fs`, etc.

**Example from `src/cloner.ts`:**
```typescript
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { promisify } from 'node:util';
```

## Error Handling

**Strategy:** Structured error propagation with credential scrubbing at all boundaries.

**Patterns:**
- Always catch `error: unknown` — never `error: Error` in catch blocks
- Convert unknown errors: `error instanceof Error ? error.message : String(error)`
- All user-visible error messages pass through `sanitizeError()` from `src/errors.ts`, which calls `scrubSecrets()`
- Empty catch blocks only when truly best-effort, always include comment: `/* best-effort */` or `/* non-fatal: defense-in-depth */`
- Functions that can fail return typed results or throw; never return `null` to signal errors
- Error messages are imperative and user-actionable: `"Error: ${label} '${value}' starts with a dash -- contains dangerous characters. Aborting review."`

**Example from `src/cli.ts`:**
```typescript
try {
  prData = await fetchPRData(octokit, parsed.owner, parsed.repo, parsed.prNumber);
} catch (error: unknown) {
  console.log(); // newline after progress message
  console.error(pc.red('\u2716 Failed to fetch PR data'));
  console.error(pc.dim('  ' + sanitizeError(error)));
  process.exit(EXIT_API_ERROR);
}
```

**Exit Codes:**
- Defined as named constants in `src/errors.ts`: `EXIT_PREREQ = 1`, `EXIT_INVALID_URL = 2`, `EXIT_API_ERROR = 3`, `EXIT_ANALYSIS_ERROR = 4`

## Logging

**Framework:** `console.log` / `console.error` + `picocolors` (`pc`) for color

**Patterns:**
- `console.log()` for normal output to stdout
- `console.error()` for error messages to stderr
- `process.stdout.write()` for progress messages without trailing newline (inline updates)
- Debug/verbose output uses `printDebug()` from `src/output.ts`, prefixed with `[debug]`
- Terminal coloring via `picocolors` imported as `pc`: `pc.red()`, `pc.green()`, `pc.dim()`, `pc.bold()`, `pc.cyan()`, `pc.yellow()`, `pc.blue()`
- No emoji in output — unicode characters used instead: `\u2716` (✖), `\u26A0` (⚠), `\u25C6` (◆), `\u25CB` (○)
- Progress messages pattern: `printProgress('Fetching PR data...')` → (work) → `printProgressDone()` (appends " done" in green on same line)

## Comments

**When to Comment:**
- JSDoc `/** */` on every exported function and interface explaining purpose, parameters, and non-obvious behavior
- Inline comments on security-critical decisions: `// Prevent stdin hang (established pattern from analyzer.ts)`, `// PENDING state: achieved by OMITTING event`
- Section dividers with comment: `// 1. Check prerequisites`, `// 2. Parse PR URL`
- Magic numbers always commented: `/** Max buffer for Claude CLI output: 10MB */`
- Security constraint context: `// Structural push prevention: remove git remote so Claude has nowhere to push`

**JSDoc Pattern:**
```typescript
/**
 * Validate a value from GitHub API is safe for use as a subprocess argument.
 * Rejects values with dangerous patterns: leading dash (git flag injection),
 * path traversal (..), null bytes.
 * Does NOT restrict valid GitHub characters (dots, slashes, hyphens allowed).
 */
export function validateGitArg(value: string, label: string): void {
```

## Function Design

**Size:** Functions are focused and small; the largest functional units are `analyzeDiff` (~70 lines) and `analyzeAgentic` (~105 lines), which manage subprocess lifecycles

**Parameters:** Prefer explicit named parameters; avoid option bags except where flag grouping is natural (CLI options). Optional parameters use `?` suffix: `model?: string`, `mode?: ReviewMode`, `verbose?: boolean`

**Return Values:**
- Functions return typed values or throw on error — no `null` as error signal
- Async functions return `Promise<T>` directly
- Null coalescing `??` used for defensive defaults: `wrapper.total_cost_usd ?? wrapper.cost_usd ?? 0`
- Nullish optional chaining: `pr.user?.login ?? 'unknown'`

## Module Design

**Exports:** Named exports only — no default exports (except for `picocolors` which is re-exported as `pc` alias). Each module exports only what external callers need.

**Barrel Files:** None — no index.ts re-export aggregators. Direct imports from specific modules.

**ESM Only:** `"type": "module"` in `package.json`. All internal imports require `.js` extension even for `.ts` source files. Never use `require()` (exception: `createRequire` in tests for JSON fixtures).

**Subprocess Invariant:** All subprocess calls use `execFile`/`execFileSync`/`spawn` with argument arrays. `exec()` with string interpolation is forbidden throughout the codebase (enforced by `security.test.ts`).

## Zod Usage

**Version:** Zod v4 — import from `"zod"` directly (not `"zod/v4"`)

**Pattern:**
```typescript
import { z } from 'zod';

const ReviewFindingSchema = z.object({
  severity: z.enum(['bug', 'security', 'suggestion', 'nitpick']),
});

// Derive TypeScript type from schema
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

// Use safeParse for validation (not parse)
const parsed = ReviewResultSchema.safeParse(data);
if (!parsed.success) {
  throw new Error(`Response validation failed: ${parsed.error.message}`);
}
```

---

*Convention analysis: 2026-03-04*

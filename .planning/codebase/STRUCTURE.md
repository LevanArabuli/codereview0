# Codebase Structure

**Analysis Date:** 2026-03-04

## Directory Layout

```
codereview0/
├── src/                  # All application source (17 TypeScript modules)
│   ├── cli.ts            # Entry point and orchestrator
│   ├── analyzer.ts       # Claude CLI subprocess invocation and response parsing
│   ├── cloner.ts         # Git clone via gh CLI with security hardening
│   ├── github.ts         # Octokit client — fetch PR data, post review
│   ├── prompt.ts         # Review prompt construction and ReviewMode type
│   ├── output.ts         # Terminal output formatting with picocolors
│   ├── review-builder.ts # Partition findings inline/off-diff, build review body
│   ├── html-report.ts    # Standalone HTML report generator
│   ├── html-diff-parser.ts # Detailed per-line diff parser for HTML rendering
│   ├── diff-parser.ts    # Hunk-range diff parser for inline comment validation
│   ├── formatter.ts      # Format findings as GitHub comment markdown
│   ├── schemas.ts        # Zod schemas for ReviewFinding and ReviewResult
│   ├── types.ts          # TypeScript interfaces (PRData, ParsedPR, DiffHunk, PRFile, PrereqFailure)
│   ├── errors.ts         # Exit codes, scrubSecrets(), sanitizeError()
│   ├── eval.ts           # Evaluation infrastructure (matchFindings, computeMetrics)
│   ├── url-parser.ts     # GitHub PR URL regex parser
│   └── prerequisites.ts  # CLI tool prerequisite checks (gh, claude)
├── tests/                # Vitest test suite
│   ├── analyzer.test.ts
│   ├── cloner.test.ts
│   ├── eval.test.ts
│   ├── github.test.ts
│   ├── html-diff-parser.test.ts
│   ├── html-report.test.ts
│   ├── output.test.ts
│   ├── prerequisites.test.ts
│   ├── prompt.test.ts
│   ├── security.test.ts
│   ├── url-parser.test.ts
│   └── fixtures/         # JSON fixture files for eval tests
│       ├── pr-1-small.json
│       ├── pr-2-medium.json
│       └── pr-3-large.json
├── dist/                 # Build output (single bundled ESM file + sourcemap)
│   ├── cli.js            # Executable with #!/usr/bin/env node shebang
│   └── cli.js.map
├── .codereview/          # Clone directory for deep review mode (runtime-generated)
├── .planning/            # GSD planning docs (not shipped)
│   └── codebase/
├── .claude/              # Claude Code commands
│   └── commands/
├── package.json          # npm manifest, bin entry, 4 runtime deps
├── tsconfig.json         # TypeScript: strict, ES2022, NodeNext modules
├── tsup.config.ts        # Build: single ESM entry, node22 target, shebang banner
├── vitest.config.ts      # Test runner configuration
├── CLAUDE.md             # Project instructions for Claude Code
├── SECURITY.md           # Security model and threat analysis
└── README.md
```

## Directory Purposes

**`src/`:**
- Purpose: All application source code — flat, no subdirectories
- Contains: 17 TypeScript ESM modules, one entry point (`cli.ts`)
- Key files: `src/cli.ts` (orchestrator), `src/analyzer.ts` (Claude integration), `src/schemas.ts` (shared types)

**`tests/`:**
- Purpose: Vitest test suite, co-located at project root (not inside `src/`)
- Contains: 11 test files mirroring module names, one `fixtures/` subdirectory
- Key files: `tests/security.test.ts` (39 security invariant tests, treat as protected), `tests/eval.test.ts` (fixture-based review quality tests)

**`tests/fixtures/`:**
- Purpose: JSON fixtures for eval tests — expected PR review findings with GOOD/MEH/BAD labels
- Contains: 3 fixture files for small/medium/large PRs
- Generated: No — hand-authored expected findings for review quality regression testing
- Committed: Yes

**`dist/`:**
- Purpose: Build output from `tsup`; single bundled ESM file with shebang
- Generated: Yes (`npm run build`)
- Committed: Yes (allows direct `npx` usage without a build step)

**`.codereview/`:**
- Purpose: Runtime clone directory for `--deep` review mode; repos cloned here
- Generated: Yes (at runtime by `src/cloner.ts`)
- Committed: No (in `.gitignore`)

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents for planning and execution phases
- Generated: Yes (by GSD map-codebase agent)
- Committed: Yes

## Key File Locations

**Entry Points:**
- `src/cli.ts`: CLI entry point, Commander setup, review pipeline orchestration
- `dist/cli.js`: Built executable, registered as `codereview` binary via `package.json` `bin`

**Core Type Definitions:**
- `src/types.ts`: `PRData`, `ParsedPR`, `PRFile`, `DiffHunk`, `PrereqFailure` interfaces
- `src/schemas.ts`: Zod schema + inferred type for `ReviewFinding` and `ReviewResult`

**Security-Critical Files:**
- `src/errors.ts`: `scrubSecrets()` and `sanitizeError()` — used in all error paths
- `src/cloner.ts`: `validateGitArg()` — used before all subprocess calls with GitHub API data
- `src/analyzer.ts`: `filterEnv()` — strips dangerous env vars from Claude subprocess

**Configuration:**
- `package.json`: Runtime deps (commander, @octokit/rest, zod, picocolors), engines (node >=22)
- `tsconfig.json`: TypeScript strict mode, ES2022 target, NodeNext module resolution
- `tsup.config.ts`: Build config — single ESM entry, node22 target, shebang banner
- `vitest.config.ts`: Test runner config

**Testing:**
- `tests/security.test.ts`: 39 tests covering INP/SUB/CRED/API/CLN security categories — do not modify without full understanding of `SECURITY.md`
- `tests/eval.test.ts`: Uses `createRequire(import.meta.url)` for ESM-compatible JSON fixture loading

## Naming Conventions

**Files:**
- `kebab-case.ts` for all source modules (e.g., `html-diff-parser.ts`, `review-builder.ts`, `url-parser.ts`)
- `kebab-case.test.ts` for test files mirroring the module name exactly

**Functions:**
- `camelCase` for all exported functions (e.g., `buildPrompt`, `parseDiffHunks`, `validateGitArg`)
- `camelCase` for all internal functions

**Types and Interfaces:**
- `PascalCase` for interfaces and type aliases (e.g., `PRData`, `ReviewFinding`, `DiffHunk`, `AnalysisMeta`)
- `SCREAMING_SNAKE_CASE` for `as const` arrays used in union types (e.g., `REVIEW_MODES`)
- `SCREAMING_SNAKE_CASE` for constants and exit codes (e.g., `EXIT_PREREQ`, `MAX_BUFFER`, `DANGEROUS_PREFIXES`)

**Schemas:**
- `PascalCase` + `Schema` suffix for Zod schemas (e.g., `ReviewFindingSchema`, `ReviewResultSchema`)

**Test files:**
- Test files import the module under test directly: `import { fn } from '../src/module.js'`

## Where to Add New Code

**New CLI flag:**
- Add option to `program` in `src/cli.ts`
- Thread the option value through to `handlePostAnalysis()` or the relevant pipeline step
- Update `options` type annotation in the `.action()` callback

**New output format (e.g., JSON output, CSV):**
- Add formatter module at `src/[format]-output.ts`
- Import and call from `handlePostAnalysis()` in `src/cli.ts`
- Add tests at `tests/[format]-output.test.ts`

**New review mode:**
- Add mode string to `REVIEW_MODES` array in `src/prompt.ts`
- Add overlay text to `MODE_OVERLAYS` in `src/prompt.ts`
- Update `--mode` choices in `src/cli.ts`
- Add test cases in `tests/prompt.test.ts`

**New utility function:**
- Shared pure helpers: add to the most relevant existing module
- If not clearly fitting anywhere, create `src/utils.ts`
- Always add tests in corresponding `tests/` file

**New test:**
- Location: `tests/[module-name].test.ts`
- Use `vi.mock()` for module mocks; `vi.fn()` for function stubs
- JSON fixtures go in `tests/fixtures/`

**New type:**
- Simple interfaces used across modules: `src/types.ts`
- Types derived from Zod validation: `src/schemas.ts` (add schema + `z.infer<>` export)

## Special Directories

**`dist/`:**
- Purpose: tsup build output; single bundled `cli.js` + sourcemap
- Generated: Yes — do not edit manually
- Committed: Yes — intentional for `npx` usage without build step

**`.codereview/`:**
- Purpose: Runtime clone directory; created and cleaned up by `src/cloner.ts`
- Generated: Yes (at runtime)
- Committed: No (gitignored)
- Note: Created with `0o700` permissions (owner-only) as a security measure

---

*Structure analysis: 2026-03-04*

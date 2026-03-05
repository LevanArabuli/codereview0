# Technology Stack

**Analysis Date:** 2026-03-05

## Languages

**Primary:**
- TypeScript 5.9.3 - All source code, strict mode enabled (`"strict": true`)

## Runtime

**Environment:**
- Node.js >= 22 (required per `engines` in package.json)

**Package Manager:**
- npm
- Lockfile: package-lock.json (present)

## Frameworks

**Build/Dev:**
- tsup 8.5.1 - Bundles TypeScript for distribution (`npm run build` → outputs to `dist/`)
- tsx 4.21.0 - Runs TypeScript directly without building (development mode: `npx tsx src/cli.ts`)
- TypeScript 5.9.3 - Compilation target ES2022, module NodeNext; strict type checking

**Testing:**
- Vitest 4.0.18 - Test runner and assertion framework (11 test files, 223+ tests)
  - Run: `npm test` (full suite) or `npx vitest run tests/[name].test.ts` (single file)

## Key Dependencies

**Critical (4 runtime dependencies only - intentionally minimal):**

- **@octokit/rest 22.0.1** - GitHub REST API client
  - Used in `src/github.ts` for PR metadata, file list, diff retrieval
  - Methods: `pulls.get`, `pulls.listFiles`, `pulls.createReview`
  - Authentication via `gh auth token` (see INTEGRATIONS.md)

- **commander 14.0.3** - CLI argument parsing and flag handling
  - Entry point: `src/cli.ts`
  - Parses flags: `--model`, `--mode`, `--post`, `--html`, `--verbose`, `--quick`, `--deep`
  - Flag validation: model ID passed directly to Claude CLI subprocess

- **picocolors 1.1.1** - Terminal color output (chosen over chalk for minimal size)
  - Used in `src/output.ts` for severity-sorted findings display
  - No emoji in terminal output (professional code review context)

- **zod 4.3.6** - Schema validation for JSON responses
  - Validates Claude CLI JSON response structure in `src/schemas.ts`
  - Schemas: `ReviewFindingSchema`, `ReviewResultSchema`
  - Type inference: `ReviewFinding` type derived from schema

**Dev Dependencies:**
- @types/node 25.2.2 - Node.js type definitions
- TypeScript 5.9.3 - Compiler (listed twice: also in devDependencies)
- Vitest 4.0.18 - Test framework

## Configuration

**Build:**
- `tsconfig.json`:
  - Compiler target: ES2022
  - Module system: NodeNext (ESM)
  - Strict mode enabled for maximum type safety
  - Source maps enabled for debugging
  - Output directory: `dist/`
  - Root directory: `src/`

**Environment:**
- No configuration files (.prettierrc, .eslintrc, .nvmrc) present
- Formatting/linting: None configured (TypeScript strict mode is the lint step: `npm run lint` = `tsc --noEmit`)
- ESM only: `"type": "module"` in package.json (no CommonJS)

**Entry Point:**
- Binary: `dist/cli.js` (built from `src/cli.ts`)
- CLI name: `codereview`

## CLI Subprocesses

**Invoked as subprocesses (not dependencies):**

- **gh CLI** (GitHub CLI)
  - Commands: `gh auth token`, `gh auth status`, `gh repo clone`
  - Environment: Token retrieved and passed to Octokit
  - Safety: Argument validation via `validateGitArg()` before subprocess use

- **claude CLI** (Anthropic Claude Code)
  - Invoked for both quick and agentic (deep) review modes
  - Input: Prompt + PR diff (via stdin or file)
  - Output: JSON with `--output-format json` flag
  - Subprocess invoked via `execFile`/`spawn` with argument arrays (no shell interpolation)
  - Environment: Filtered via `filterEnv()` (dangerous prefixes stripped, safe vars preserved)
  - Timeout: 5 minutes (quick), 10 minutes (agentic)
  - Max buffer: 10MB for output
  - Max turns: 75 (agentic mode safety limit)

## Platform Requirements

**Development:**
- Node.js >= 22
- gh CLI (GitHub CLI) installed and authenticated (`gh auth login`)
- claude CLI installed (Anthropic Claude Code: https://docs.anthropic.com/en/docs/claude-code)

**Production:**
- Same prerequisites as development (CLI tool, not a server)
- ANTHROPIC_API_KEY environment variable required (for Claude Code)
- GH_TOKEN or GITHUB_TOKEN environment variable required (for GitHub API)

## Constraints & Policies

**Module System:**
- ESM only (`import`/`export`)
- No CommonJS (`require()`) except for JSON fixtures in tests (via `createRequire`)

**Dependencies:**
- Strict 4-dependency budget (command, octokit, zod, picocolors)
- No heavy terminal UI libraries (no chalk, boxen, ink, cli-table3)
- No syntax highlighter for HTML reports (no highlight.js)

**Subprocess Invocation:**
- All external processes use `execFile`/`execFileSync`/`spawn` with argument arrays
- Never `exec()` with string interpolation (security invariant)

**Output:**
- No emoji in terminal or GitHub review output (professional context)

---

*Stack analysis: 2026-03-05*

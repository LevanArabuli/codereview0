# CLAUDE.md

@.planning/PROJECT.md
@SECURITY.md

## Commands

```bash
npm run build      # Build with tsup (outputs to dist/)
npm test           # Run tests with vitest (vitest run)
npm run lint       # Type-check with tsc --noEmit (no linter -- this IS the lint step)
npx tsx src/cli.ts # Run CLI in dev mode without building
```

**Node >= 22 required** (see `engines` in package.json).

## Architecture

All source lives in `src/`. 17 modules, single entry point:

| Module | Responsibility |
|--------|---------------|
| `cli.ts` | Entry point. Commander setup, flag parsing, orchestrates quick/deep review flows |
| `analyzer.ts` | Invokes Claude Code CLI as subprocess (`execFile`/`spawn`), parses JSON response, validates with Zod |
| `cloner.ts` | Git clone via `gh repo clone` with security hardening (validation, 0o700 permissions, cleanup) |
| `github.ts` | Octokit client -- fetches PR metadata, diff, file list; posts PENDING reviews |
| `prompt.ts` | Constructs review prompts (quick/agentic modes, mode overlays like strict/detailed/lenient); defines ReviewMode type |
| `output.ts` | Terminal output formatting, severity-sorted findings display with picocolors |
| `review-builder.ts` | Builds GitHub review body from off-diff findings |
| `html-report.ts` | Generates standalone HTML report with inline finding annotations |
| `html-diff-parser.ts` | Parses unified diffs for HTML rendering (separate from diff-parser.ts) |
| `diff-parser.ts` | Line-in-diff validation for GitHub inline comments (is line N in the diff?) |
| `formatter.ts` | Formats findings as GitHub comment markdown |
| `schemas.ts` | Zod schemas for Claude CLI response validation |
| `types.ts` | TypeScript type definitions (PRData, ParsedPR, DiffHunk, PRFile, PrereqFailure) |
| `errors.ts` | Custom error classes (AnalysisError, CloneError, etc.) |
| `eval.ts` | Evaluation infrastructure for fixture-based testing of review quality |
| `url-parser.ts` | Parses GitHub PR URLs into owner/repo/number |
| `prerequisites.ts` | Checks for required CLI tools (gh, claude) before running |

## Conventions

- **ESM only** -- `"type": "module"` in package.json; use `import`/`export`, never `require()` (exception: `createRequire` for JSON fixtures in tests)
- **Strict TypeScript** -- `"strict": true` in tsconfig.json, target ES2022, module NodeNext
- **`execFile` not `exec`** -- All subprocess calls use `execFile`/`execFileSync`/`spawn` with argument arrays. Never `exec()` with string interpolation. This is a security invariant.
- **Minimal runtime dependencies** -- Only 4: commander, @octokit/rest, zod, picocolors. Do not add dependencies for features achievable with built-in Node APIs.
- **picocolors not chalk** -- Use `picocolors` for terminal colors. Do not add chalk, kleur, or other color libraries.
- **Zod 4** -- Schema validation uses Zod v4. Import from `"zod"` directly.
- **No emoji in code output** -- GitHub comments and terminal output avoid emoji (unprofessional for code review context)

## Testing

- **Framework**: Vitest (`describe`/`it`/`expect`)
- **Location**: `tests/*.test.ts` (11 test files, 223+ tests)
- **Run single file**: `npx vitest run tests/output.test.ts`
- **Mocking**: `vi.mock()` for module mocks, `vi.fn()` for function stubs
- **Fixture pattern**: `eval.test.ts` uses `createRequire(import.meta.url)` to load JSON fixtures (ESM-compatible JSON import)
- **Security tests**: `security.test.ts` has 39 tests covering INP/SUB/CRED/API/CLN categories -- do not modify without understanding the security model

## Security constraints

These are non-negotiable invariants. Read SECURITY.md for the full threat model.

- **No `exec()` with shell interpolation** -- Always `execFile`/`spawn` with argument arrays
- **Validate untrusted inputs** -- Branch names, repo names, owner names pass through `validateGitArg()` before subprocess use. Rejects leading dashes, path traversal (`..`), null bytes.
- **Scrub credentials always** -- All error messages and verbose output pass through `scrubSecrets()`. No escape hatch, even in `--verbose` mode.
- **Filter environment for Claude subprocess** -- `filterEnv()` strips dangerous env var prefixes (AWS, Azure, GCP, DB, CI secrets)
- **Clone directory safety** -- Created with `0o700` permissions, cleaned up via try/finally and SIGINT handler
- **Read-only API surface** -- Octokit: `pulls.get`, `pulls.listFiles`, `pulls.createReview` (PENDING only). No destructive calls.
- **Structural push prevention** -- `git remote remove origin` after clone so Claude cannot push even if prompted to

## Do not

- Add runtime dependencies without strong justification (keep the 4-dep budget)
- Use `exec()` or shell string interpolation for subprocesses
- Use chalk, boxen, ink, cli-table3, or other heavy terminal libraries
- Add interactive terminal UI, webhook/bot modes, or GitHub Actions integration
- Implement auto-approve, auto-merge, or request-changes verdicts
- Add syntax highlighting to HTML reports (no highlight.js)
- Skip credential scrubbing in any code path
- Modify security tests without understanding the full security model in SECURITY.md

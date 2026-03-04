# External Integrations

**Analysis Date:** 2026-03-04

## APIs & External Services

**AI Analysis:**
- Anthropic Claude CLI - Performs code review analysis as a subprocess
  - SDK/Client: `claude` CLI binary (external tool, not an npm package)
  - Invocation: `execFile('claude', ['-p', prompt, '--output-format', 'json', ...])` for quick mode; `spawn('claude', [..., '--output-format', 'stream-json', '--verbose', ...])` for deep/agentic mode
  - Auth: `ANTHROPIC_API_KEY` environment variable (consumed by Claude CLI subprocess)
  - Implemented in: `src/analyzer.ts`
  - Output format: Double-parsed JSON - outer `ClaudeResponse` wrapper, inner `ReviewResultSchema` findings array
  - Retry logic: 1 retry on failure (quick mode only); no retry in agentic mode
  - Timeouts: 5 minutes (quick), 10 minutes (agentic)
  - Max turns: 10 (quick), 75 (agentic)

**GitHub:**
- GitHub REST API via `@octokit/rest` - Fetches PR data and posts reviews
  - SDK/Client: `@octokit/rest` npm package, instantiated in `src/github.ts`
  - Auth: Token retrieved via `gh auth token` CLI command at startup
  - Implemented in: `src/github.ts`
  - Endpoints used (read-only except one write):
    - `pulls.get` - PR metadata and unified diff (called twice: JSON and diff mediaType)
    - `pulls.listFiles` - Changed file list (max 100 files per request)
    - `pulls.createReview` - Posts PENDING/draft review (no `event` param = draft, user submits manually)
  - Error handling: 422 fallback - if inline comments fail, all findings promoted to review body

## Data Storage

**Databases:**
- None - no database of any kind

**File Storage:**
- Local filesystem only
  - Clone directory: `.codereview/<repoName>/` under current working directory
  - Created with `mode: 0o700` (owner-only permissions)
  - Cleaned up via `try/finally` and SIGINT handler
  - HTML reports: generated to filesystem when `--html` flag passed (path determined in `src/html-report.ts`)

**Caching:**
- None

## Authentication & Identity

**GitHub Auth:**
- Delegated entirely to `gh` CLI
  - Token retrieval: `execFileSync('gh', ['auth', 'token'])` in `src/github.ts`
  - Auth check: `execFileSync('gh', ['auth', 'status'])` in `src/prerequisites.ts`
  - Token format: supports `ghp_*`, `gho_*`, `ghs_*`, `ghr_*`, `ghu_*`, `github_pat_*`
  - Token is scrubbed from all error messages and verbose output via `scrubSecrets()` in `src/errors.ts`

**Anthropic Auth:**
- Delegated entirely to Claude CLI subprocess
  - `ANTHROPIC_API_KEY` env var passed through to subprocess (explicitly preserved in `filterEnv()`)
  - Key format: `sk-ant-*`
  - Key is scrubbed from all error messages and verbose output via `scrubSecrets()` in `src/errors.ts`

## Monitoring & Observability

**Error Tracking:**
- None - no external error tracking service

**Logs:**
- Terminal output only via `picocolors` (`src/output.ts`)
- Structured exit codes: 1 (prereq), 2 (invalid URL), 3 (API error), 4 (analysis error) defined in `src/errors.ts`
- `--verbose` flag exposes: model used, timing (fetch/clone/analyze/post durations), prompt size estimate, finding counts, Claude session metadata (cost, turns, session ID)
- All verbose output passes through `scrubSecrets()` before display

## CI/CD & Deployment

**Hosting:**
- npm package (`codereview0`) published to npm registry
- CLI binary: `codereview` command maps to `./dist/cli.js`

**CI Pipeline:**
- Not detected - no CI config files (`.github/workflows/`, `.circleci/`, etc.) in codebase

## Environment Configuration

**Required env vars (at runtime):**
- `ANTHROPIC_API_KEY` - Passed to Claude CLI subprocess (required for AI analysis)
- `GH_TOKEN` or `GITHUB_TOKEN` - Used by `gh` CLI for GitHub auth (alternative to `gh auth login`)

**Env var filtering for Claude subprocess (`src/analyzer.ts` `filterEnv()`):**
- Strips prefixes: `AWS_`, `AZURE_`, `GCP_`, `GOOGLE_`, `DATABASE_`, `REDIS_`, `MONGO_`, `SECRET_`, `PASSWORD_`, `CI_`, `JENKINS_`, `TRAVIS_`, `CIRCLE_`, `TOKEN_`, `KEY_`
- Strips exact names: `DATABASE_URL`, `REDIS_URL`
- Preserves: `ANTHROPIC_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`

**Secrets location:**
- `.env` files excluded from git (via `.gitignore`)
- No `.env.example` present despite `.gitignore` carve-out for it

## Webhooks & Callbacks

**Incoming:**
- None - pure CLI tool, no server

**Outgoing:**
- None - all communication is request-response (GitHub API via Octokit, Claude CLI via subprocess)

## External CLI Tool Dependencies

These are runtime dependencies not managed by npm:

- `gh` (GitHub CLI) - Required for: auth token retrieval, auth status check, `gh repo clone`
  - Install: https://cli.github.com
  - Prerequisite check: `src/prerequisites.ts`
- `claude` (Anthropic Claude CLI / Claude Code) - Required for: AI analysis in both quick and deep modes
  - Install: https://docs.anthropic.com/en/docs/claude-code
  - Prerequisite check: `src/prerequisites.ts`
- `git` - Used for `git remote remove origin` after clone (defense-in-depth push prevention)
  - Assumed to be present; failure is non-fatal (try/catch in `src/cloner.ts`)

---

*Integration audit: 2026-03-04*

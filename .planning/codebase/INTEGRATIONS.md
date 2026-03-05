# External Integrations

**Analysis Date:** 2026-03-05

## APIs & External Services

**GitHub:**
- GitHub REST API - Fetch PR metadata, file list, unified diff; post code reviews
  - SDK/Client: @octokit/rest 22.0.1
  - Auth mechanism: GitHub CLI token (`gh auth token` → Octokit)
  - Methods used (read-only + PENDING review write):
    - `pulls.get()` - Fetch PR metadata and diff (via format: 'diff' mediaType)
    - `pulls.listFiles()` - Fetch changed files list (100 files per page)
    - `pulls.createReview()` - Post review findings (PENDING state only, no event parameter)
  - Implementation: `src/github.ts`

**Anthropic Claude:**
- Claude Code CLI - AI-powered code analysis for review findings
  - Invocation: Subprocess via `execFile`/`spawn` (not an API client)
  - Protocol: JSON via `--output-format json` flag
  - Modes: Quick review (claude -p) and agentic deep review (claude -p with session flag)
  - Environment: Filtered to remove dangerous prefixes (AWS, Azure, GCP, DB credentials, CI secrets)
  - Input channel: System prompt + PR diff via stdin or temp file
  - Output parsing: Zod schema validation in `src/schemas.ts`
  - Models: User-specified via `--model` flag (default model determined by Claude CLI)
  - Implementation: `src/analyzer.ts`

## Git & Repository Access

**GitHub CLI (gh):**
- Repository cloning - `gh repo clone [owner]/[repo]` for deep analysis
  - Shallow clone with `--depth 1` and `--single-branch [headBranch]`
  - Directory: `.codereview/[repoName]/` (local filesystem)
  - Permissions: Created with `0o700` (owner-only access)
  - Post-clone security: `git remote remove origin` to prevent accidental pushes
  - Implementation: `src/cloner.ts`
  - Cleanup: Via try/finally and SIGINT handler (user prompt on normal exit)

- Authentication: `gh auth status`, `gh auth token`
  - Token retrieval for Octokit initialization
  - Implementation: `src/github.ts`, `src/prerequisites.ts`

## Authentication & Identity

**GitHub Authentication:**
- Method: OAuth token from gh CLI (`gh auth token`)
- Token storage: Managed by gh CLI (user-provided credentials)
- Scope: Read PR metadata/files, write PENDING reviews (no destructive operations)
- Environment variable used: `GH_TOKEN` or `GITHUB_TOKEN` (preserved during subprocess filtering)
- Prerequisite check: `gh auth status` (must be authenticated before analysis)
- Implementation: `src/github.ts`, `src/prerequisites.ts`

**Anthropic API Key:**
- Method: Environment variable `ANTHROPIC_API_KEY`
- Used by: Claude Code CLI subprocess
- Scope: AI model inference for code review
- Credential safety: Variable preserved in `filterEnv()` KEEP_LIST for Claude subprocess
- No direct HTTP calls to Anthropic API (all via Claude CLI subprocess)

## Data Flow

**Quick Review Flow:**
1. Parse GitHub PR URL via `src/url-parser.ts`
2. Fetch PR metadata via Octokit (GitHub API)
3. Build review prompt from PR diff (`src/prompt.ts`)
4. Invoke Claude CLI subprocess with prompt (read-only analysis)
5. Parse JSON response with Zod schema (`src/schemas.ts`)
6. Format and display findings (`src/output.ts`)
7. Optional: Post PENDING review to GitHub (`src/github.ts`)

**Deep (Agentic) Review Flow:**
1. Same as quick flow, but clones repository
2. Clone repo via `gh repo clone` with security hardening (`src/cloner.ts`)
3. Remove origin remote to prevent pushes
4. Invoke Claude CLI with agentic prompt (session-based, multi-turn analysis)
5. Claude can read files during analysis (codebase access, read-only)
6. Same parsing, formatting, and posting as quick flow

## Webhooks & Callbacks

**Incoming:** Not applicable (CLI tool, not a service)

**Outgoing:** GitHub review posting only (via `pulls.createReview`)

## Environment Configuration

**Required environment variables:**
- `ANTHROPIC_API_KEY` - Anthropic API key for Claude Code CLI
- `GH_TOKEN` or `GITHUB_TOKEN` - GitHub authentication token

**Optional:**
- `GITHUB_TOKEN` - Alternative name for GH_TOKEN

**Secrets location:**
- Managed by gh CLI (no local secrets files committed)
- API key provided by user at runtime

**Credential scrubbing:**
- All error messages and verbose output pass through `scrubSecrets()` (`src/errors.ts`)
- Patterns masked:
  - GitHub tokens: `ghp_*`, `gho_*`, `ghs_*`, `ghr_*`, `ghu_*`, `github_pat_*`
  - Anthropic API keys: `sk-ant-*`
  - Bearer/token auth headers: `Bearer .*`, `token .*`
  - URL-embedded credentials: stripped from error messages
- Policy: No escape hatch, even in `--verbose` mode

## Subprocess Environment Filtering

**Environment filtering policy (SUB-02, `src/analyzer.ts`):**

Dangerous prefixes stripped from Claude CLI subprocess:
- `AWS_`, `AZURE_`, `GCP_`, `GOOGLE_` (cloud credentials)
- `DATABASE_`, `REDIS_`, `MONGO_` (database credentials)
- `SECRET_`, `PASSWORD_` (generic secrets)
- `CI_`, `JENKINS_`, `TRAVIS_`, `CIRCLE_` (CI/CD secrets)
- `TOKEN_`, `KEY_` (generic tokens/keys)

Exact variables stripped:
- `DATABASE_URL`, `REDIS_URL`

Variables always preserved (KEEP_LIST):
- `ANTHROPIC_API_KEY` (required for Claude CLI)
- `GH_TOKEN`, `GITHUB_TOKEN` (required for GitHub CLI)

This blocklist approach reduces risk of credential leakage to untrusted PR content while preserving required API access.

## API Safety Audit

| Component | Method/Command | Access Level | Notes |
|-----------|---|---|---|
| Octokit | `pulls.get` | Read | PR metadata + diff |
| Octokit | `pulls.listFiles` | Read | Changed files list |
| Octokit | `pulls.createReview` | Write (PENDING) | No `event` param = draft review, user submits manually |
| gh CLI | `gh auth token` | Read | Token retrieval for Octokit |
| gh CLI | `gh auth status` | Read | Prerequisite check |
| gh CLI | `gh repo clone` | Read | Shallow clone of PR branch |
| Claude CLI | `claude -p` | Read (codebase) | Agentic analysis with prompt guardrails, no tool restrictions |

## Known Limitations

**Claude CLI tool restrictions:**
- Claude CLI does not expose `--disallowedTools` flag to restrict available tools during agentic sessions
- Mitigation: Prompt guardrails instruct read-only operation; structural prevention (remote removed) limits blast radius
- Acceptable risk: Environment filtering + remote removal + PENDING review (user approval required)

**Environment variable blocking:**
- Blocklist approach: Novel or custom env var names containing secrets may not be filtered
- Mitigation: Known dangerous prefixes cover common cloud/database/CI systems

---

*Integration audit: 2026-03-05*

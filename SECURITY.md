# Security Model

`codereview` is an AI-powered CLI tool that reviews GitHub pull requests using Claude. It fetches PR data via the GitHub API, optionally clones the repository for deep analysis, and returns structured review findings.

## Trust Boundaries

1. **User input**: PR URL from command line, `--model` flag, `--mode` flag
2. **GitHub API data**: PR metadata, file list, diff content (controlled by PR author)
3. **Claude CLI**: Subprocess that performs AI analysis with access to the cloned repo
4. **Cloned repository**: Untrusted content from the PR author's branch

The primary threat is a malicious PR author who crafts PR content (branch names, file paths, diff content) to exploit the review tool.

## Mitigations

### Input Validation (INP-01, INP-02)

- **Git argument validation**: All GitHub API values (owner, repo name, branch name) pass through `validateGitArg()` before use in any subprocess call. Rejects leading dashes (git flag injection), path traversal sequences (`..`), and null bytes.
- **Path traversal prevention**: `getClonePath()` uses `path.resolve()` + `startsWith()` boundary check to ensure clone directories cannot escape the `.codereview/` base directory.
- **Repo name validation**: Repository names are additionally checked for `/` and `\` characters (not valid in GitHub repo names).

### Subprocess Hardening (SUB-01, SUB-02)

- **No shell injection**: All subprocess calls use `execFile`/`execFileSync` with argument arrays. No `exec()` with string interpolation exists anywhere in the codebase.
- **Environment filtering**: The Claude CLI subprocess receives a filtered copy of `process.env` via `filterEnv()`. Known-dangerous environment variable prefixes (AWS, Azure, GCP, database URLs, CI secrets) are stripped. Required keys (`ANTHROPIC_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`) are preserved.

### Credential Safety (CRED-01, CRED-02)

- **Error message scrubbing**: All catch blocks in the CLI use `sanitizeError()` which passes error messages through `scrubSecrets()` before display. This covers GitHub tokens (`ghp_*`, `gho_*`, `ghs_*`, `ghr_*`, `ghu_*`, `github_pat_*`), Anthropic API keys (`sk-ant-*`), Bearer/token auth headers, and URL-embedded credentials.
- **Verbose output scrubbing**: All debug/verbose output from the Claude CLI subprocess passes through `scrubSecrets()` before reaching the terminal.
- **Always-scrub policy**: Credential scrubbing has no escape hatch. Even `--verbose` mode scrubs all sensitive patterns.

### Clone Directory Safety (CLN-01, CLN-02)

- **Restrictive permissions**: Clone directories are created with `mode: 0o700` (owner-only access) before the `gh repo clone` command runs.
- **SIGINT cleanup**: A process-level SIGINT handler ensures clone directories are cleaned up even if the user interrupts with Ctrl+C.
- **Try/finally safety net**: The deep review flow wraps clone + analysis in try/finally to clean up orphaned directories on any unhandled error path.
- **Prompt-based cleanup**: On normal exit, the user is prompted to keep or delete the clone (defaults to delete).

### API Safety (API-01, API-02, API-03)

- **Read-only Octokit surface**: The tool uses only three Octokit methods:
  - `pulls.get` -- read-only PR metadata and diff
  - `pulls.listFiles` -- read-only file list
  - `pulls.createReview` -- creates a **PENDING** review (the `event` parameter is omitted, which creates a draft that the user must manually submit through the GitHub UI)
- **No destructive API calls**: The tool never calls any Octokit method that approves, merges, closes, or deletes anything.
- **Safe `gh` CLI usage**: The tool invokes `gh` only for:
  - `gh auth token` -- retrieves the authentication token
  - `gh auth status` -- checks authentication status
  - `gh repo clone` -- clones the repository (read-only)
- **Structural push prevention**: After cloning, `git remote remove origin` is executed. This removes the remote entirely so that even if Claude attempts `git push`, there is no remote to push to.
- **Agentic prompt guardrails**: The system prompt for deep (agentic) reviews includes explicit constraints: NEVER push, NEVER modify files, NEVER close/merge/approve PRs, NEVER delete resources. Claude is instructed that its role is READ-ONLY analysis.

## API Surface Audit

| Component | Method/Command | Access Level | Notes |
|-----------|---------------|--------------|-------|
| Octokit | `pulls.get` | Read | PR metadata + diff |
| Octokit | `pulls.listFiles` | Read | Changed file list |
| Octokit | `pulls.createReview` | Write (PENDING) | No `event` param = draft review, user submits manually |
| gh CLI | `gh auth token` | Read | Token retrieval for Octokit |
| gh CLI | `gh auth status` | Read | Prerequisite check |
| gh CLI | `gh repo clone` | Read | Shallow clone of PR branch |
| Claude CLI | `claude -p` | Read (codebase) | Agentic analysis with prompt guardrails |

## `--model` Flag Safety

The `--model` CLI flag is passed directly to the Claude CLI as an argument via `execFile` (not through a shell). This is safe because:

1. **No shell injection**: `execFile` with argument arrays prevents any shell metacharacter interpretation
2. **Claude CLI validation**: The Claude CLI itself validates the model parameter and rejects invalid model IDs
3. **No security impact**: An invalid model value only causes the Claude CLI to fail with an error -- it cannot affect other parts of the system

No input validation is applied to `--model` because the above properties make it safe by construction.

## Accepted Risks

### Prompt Injection via PR Content

**Risk**: A malicious PR author could craft diff content, PR title, or PR description designed to manipulate Claude's analysis (e.g., instructing Claude to ignore security issues, output misleading findings, or attempt tool use beyond its constraints).

**Why this is accepted**: The PR diff IS the content being reviewed. Any sanitization or filtering of the diff would degrade review quality -- Claude needs to see the actual code to provide useful feedback. This is a fundamental property of LLM-based code review, not a design flaw.

**Mitigations in place**:
- Structural push prevention (remote removed) limits blast radius even if Claude is manipulated
- Prompt guardrails instruct Claude to operate in read-only mode
- The tool's API surface is limited to read operations and PENDING reviews
- Environment filtering prevents credential leakage to the Claude subprocess
- The PENDING review status means findings are never auto-published -- a human reviews them

**Reference**: This aligns with OWASP LLM Top 10 (LLM01:2025 -- Prompt Injection). The recommended mitigation for indirect prompt injection in content-analysis systems is defense-in-depth, not content filtering.

### Claude CLI Tool Restrictions

**Known limitation**: The Claude CLI does not currently expose a `--disallowedTools` flag or equivalent mechanism to restrict which tools Claude can use during agentic sessions. The tool relies on prompt-level guardrails and structural prevention (remote removal) rather than hard tool restrictions.

**Impact**: Claude could theoretically execute any Bash command during deep review. The prompt guardrails and remote removal significantly limit the blast radius, but they are not a hard sandbox.

**Mitigation**: Claude CLI has its own permission model that controls tool access. When run non-interactively (as this tool does), Claude CLI applies its default permission settings. Full sandboxing of the Claude CLI subprocess is delegated to the Claude CLI's own security model.

## Known Limitations

1. **No hard tool sandboxing**: Prompt guardrails are best-effort. A sophisticated prompt injection could potentially cause Claude to execute unintended commands during deep review. Structural mitigations (remote removal, env filtering) limit impact.
2. **PENDING review is not zero-impact**: Even a PENDING/draft review is visible to repository collaborators. A manipulated review could contain misleading content that a human might not catch.
3. **Clone directory timing window**: There is a brief window between `gh repo clone` and `git remote remove origin` where the remote exists. In practice, no code runs during this window.
4. **Environment variable blocklist**: The env filtering uses a blocklist approach. Novel or custom environment variable names containing secrets would not be filtered unless they match the known dangerous prefixes.

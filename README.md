# codereview

AI-powered GitHub PR code review using Claude. Explores the full codebase to catch issues a surface-level diff review would miss.

## Installation

Requires Node.js 22+, [Claude CLI](https://docs.anthropic.com/en/docs/claude-code), and [`gh` CLI](https://cli.github.com) authenticated.

Verify prerequisites:

```bash
node --version    # Must be 22+
gh auth status    # Must be authenticated
claude --version  # Must be installed with Anthropic API key
```

```bash
git clone <repo-url>
cd codereview
npm install
npm run build
npm link
codereview --version  # Verify install
```

## Usage

```bash
# Quick review (diff-only, default)
codereview https://github.com/owner/repo/pull/123

# Deep review (clones repo, explores codebase)
codereview https://github.com/owner/repo/pull/123 --deep

# Post review to GitHub PR
codereview https://github.com/owner/repo/pull/123 --deep --post

# Generate HTML diff report with inline annotations
codereview https://github.com/owner/repo/pull/123 --html

# Strict mode (bugs and security only, no nitpicks)
codereview https://github.com/owner/repo/pull/123 --mode strict

# Use a specific model
codereview https://github.com/owner/repo/pull/123 --model sonnet
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--quick` | Quick review: analyze diff only (default) |
| `--deep` | Deep review: clone repo and explore codebase for cross-file impacts |
| `--post` | Post review as GitHub PR comments |
| `--verbose` | Show debug info including timing, model, and token counts |
| `--model <id>` | Claude model to use (e.g., `sonnet`, `opus`, `haiku`, or full model ID) |
| `--mode <mode>` | Review mode: `balanced` (default), `strict`, `detailed`, or `lenient` |
| `--html` | Generate standalone HTML diff report with inline finding annotations |

## Review Modes

| Mode | Description |
|------|-------------|
| `balanced` | Default. Skips nitpicks, good signal-to-noise ratio |
| `strict` | Bugs and security issues only, nothing else |
| `detailed` | Thorough review including all categories and nitpicks |
| `lenient` | No nitpicks, higher bar for suggestions |

When using `--post`, the tool creates PENDING reviews on GitHub. You still need to submit them manually through the GitHub UI, so nothing gets posted without your approval.

## Example Output

```
Add null safety to user service
#42 johndoe feature/null-safety -> main
+28 -3 2 files changed

+15 -2 src/user-service.ts
+13 -1 src/auth.ts

✖ 1 bug · ◆ 2 suggestions · ○ 1 nitpick

  ✖ bug src/user-service.ts:42 Missing null check before accessing user.email.
    The user object can be undefined when the session expires, causing
    a TypeError at runtime. Guard with an early return or optional chaining.

  ◆ suggestion src/auth.ts:15 Consider using a constant for the token expiry.
    The magic number 3600 appears in multiple places. Extract to a named
    constant for clarity and easier maintenance.

  ◆ suggestion src/user-service.ts:88 Duplicated validation logic.
    This null-check pattern is repeated in three service methods. Extract
    to a shared helper to reduce duplication.

  ○ nitpick src/auth.ts:3 Unused import.
    The 'crypto' import is not referenced in this file.
```

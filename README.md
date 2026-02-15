# codereview

AI-powered GitHub PR code review using Claude. Explores the full codebase to catch issues a surface-level diff review would miss.

## Installation

Requires Node.js 22+, [Claude CLI](https://docs.anthropic.com/en/docs/claude-code), and [`gh` CLI](https://cli.github.com) authenticated.

```bash
git clone <repo-url>
cd codereview
npm install
npm run build
```

## Usage

```bash
# Quick review (diff-only, default)
codereview https://github.com/owner/repo/pull/123

# Deep review (clones repo, explores codebase)
codereview https://github.com/owner/repo/pull/123 --deep

# Post review to GitHub PR
codereview https://github.com/owner/repo/pull/123 --deep --post

# Use a specific model
codereview https://github.com/owner/repo/pull/123 --model sonnet
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--quick` | Quick review: analyze diff only (default) |
| `--deep` | Deep review: clone repo and explore codebase for cross-file impacts |
| `--post` | Post review as GitHub PR comments |
| `--verbose` | Show debug info including raw diff |
| `--model <id>` | Claude model to use (e.g., `sonnet`, `opus`, `haiku`, or full model ID) |

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

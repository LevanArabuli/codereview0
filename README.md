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

<img width="1727" height="1008" alt="Screenshot 2026-02-27 at 10 12 04" src="https://github.com/user-attachments/assets/e91bee0a-2241-43aa-aea0-4fdafa3fae63" />


# codereview

**Code review that actually reads the code.**  

Claude-powered reviews for GitHub PRs and local branches. Thorough, configurable, and ready when you are.

- 🔍 **PR reviews** - Point it at any GitHub PR and get a detailed review in seconds
- 🌳 **Local branch diffs** - Review changes before you even open a PR, fully offline
- 🧠 **Deep mode** - Optionally clones the repo and explores cross-file impacts
- 💬 **Post to GitHub** - Adds review comments directly on the PR (as pending, so you stay in control)
- 📄 **HTML reports** - Generates standalone diff reports with inline annotations
- ⚡ **GitHub Action** - Drop a workflow into any repo and trigger reviews with a `/review` comment
  

<img width="1727" height="1008" alt="codereview output showing annotated diff with findings" src="https://github.com/user-attachments/assets/e91bee0a-2241-43aa-aea0-4fdafa3fae63" />

*Example: Output from running codereview on a PR. Summary, severity counts, and findings with file:line and description.*

## Getting started

You'll need Node.js 22+ and the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code). If you want to review GitHub PRs, you'll also need the [`gh` CLI](https://cli.github.com) authenticated.

```bash
# Check prerequisites
node --version    # Must be 22+
claude --version  # Must be installed with Anthropic API key
gh auth status    # Only needed for PR reviews
```

Then install:

```bash
git clone <repo-url>
cd codereview
npm install
npm run build
npm link
codereview --version  # You're good to go
```

## How it works

In **quick mode** (the default), `codereview` sends the diff to Claude for analysis - fast and lightweight.

In **deep mode** (`--deep`), it goes further: cloning the repo (for PRs) or reading your local codebase (for branches) so Claude can trace how changes ripple across files, spot broken contracts, and understand the bigger picture.

Either way, you get a structured review with findings categorized by severity and type.

## Reviewing a GitHub PR

```bash
# Quick review (diff-only, default)
codereview https://github.com/owner/repo/pull/123

# Deep review (clones repo, explores codebase)
codereview https://github.com/owner/repo/pull/123 --deep

# Post findings as GitHub PR comments
codereview https://github.com/owner/repo/pull/123 --deep --post

# Generate a standalone HTML diff report
codereview https://github.com/owner/repo/pull/123 --html

# Bugs and security only, skip the noise
codereview https://github.com/owner/repo/pull/123 --mode strict

# Use a specific model
codereview https://github.com/owner/repo/pull/123 --model sonnet
```

> **Note:** `--post` creates *pending* reviews on GitHub. Nothing goes live until you submit them through the GitHub UI.

## Reviewing local branches

Review the diff between two branches without opening a PR - great for checking your work before pushing, or reviewing a teammate's branch locally. No GitHub access needed.

**Syntax:** `codereview branch <base> <compare>`

- **base** - the branch you're comparing against (e.g. `main`, `rc`). What you branched from.
- **compare** - the branch with the new work. The one you want reviewed.

Think of it like a PR: `codereview branch rc-branch feature/login-refactor` means "review the changes in `feature/login-refactor` that aren't in `rc-branch`."

```bash
# Review feature branch against rc
codereview branch rc-branch feature/login-refactor

# Just one branch? It auto-detects main/master as the base
codereview branch feature/login-refactor

# Same flags work here too
codereview branch rc-branch feature/login-refactor --deep
codereview branch rc-branch feature/login-refactor --html
codereview branch rc-branch feature/login-refactor --mode strict
```

The diff uses merge-base semantics (`git diff base...compare`), so results match what GitHub would show for the same branches in a PR.

## Use as a GitHub Action

Run `codereview` automatically on any PR by commenting `/review` (or `/review deep`). No local install, no laptop required.

### One-time setup in your repo

1. Add `ANTHROPIC_API_KEY` to your repo's secrets (Settings → Secrets and variables → Actions).
2. Copy [`examples/consumer-workflow.yml`](examples/consumer-workflow.yml) into your repo as `.github/workflows/codereview.yml`.
3. Pin the action version. Replace `@main` with a release tag once you're ready (e.g. `@v1`).

```yaml
- uses: LevanArabuli/codereview0@v1
  with:
    pr_url: ${{ github.event.issue.pull_request.html_url }}
    mode: ${{ steps.cmd.outputs.mode }}
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### What it does

Opens or updates a **pending** review on the PR with inline findings. You still submit the review manually through the GitHub UI — `codereview` never approves, requests changes, or merges anything.

### Action inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `pr_url` | yes | — | PR URL to review |
| `anthropic_api_key` | one-of\* | — | Anthropic (or compatible provider) API key |
| `anthropic_auth_token` | one-of\* | — | Bearer-style token for providers that use `ANTHROPIC_AUTH_TOKEN` |
| `anthropic_base_url` | no | — | Custom API endpoint (LiteLLM, OpenRouter, self-hosted proxy) |
| `mode` | no | `quick` | `quick` or `deep` |
| `review_mode` | no | `balanced` | `strict`, `detailed`, `balanced`, or `lenient` |
| `model` | no | (CLI default) | e.g. `sonnet`, `opus`, `haiku`, or a provider-specific model ID |
| `github_token` | no | `${{ github.token }}` | Needs `pull-requests: write` |
| `claude_code_version` | no | `latest` | `@anthropic-ai/claude-code` version to install |

\* Pass either `anthropic_api_key` or `anthropic_auth_token` — the action fails fast if both are empty.

### Custom Anthropic-compatible providers

If you route Claude through a proxy or alternate provider (LiteLLM, OpenRouter, self-hosted gateway), set `anthropic_base_url` to that provider's endpoint and use whichever of `anthropic_api_key` / `anthropic_auth_token` your provider expects. The action passes `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` straight to the Claude CLI subprocess — same env vars Claude Code reads when run locally.

```yaml
- uses: LevanArabuli/codereview0@v1
  with:
    pr_url: ${{ github.event.issue.pull_request.html_url }}
    mode: ${{ steps.cmd.outputs.mode }}
    anthropic_base_url: https://your-proxy.example.com
    anthropic_auth_token: ${{ secrets.ANTHROPIC_AUTH_TOKEN }}
    model: your-provider-model-id
```

### Required workflow permissions

```yaml
permissions:
  pull-requests: write   # post the pending review
  issues: read           # read the /review comment
  contents: read         # checkout in deep mode
```

Without `pull-requests: write` the action will fail when posting the review.

### Public repos: gate `/review` to trusted commenters

The example workflow only runs when the commenter's `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR`. Without that gate, anyone with a GitHub account could comment `/review` on your public PR and burn your `ANTHROPIC_API_KEY` credits. On a private repo where every commenter is already trusted, you can drop the check — see the comment in `examples/consumer-workflow.yml`.

## CLI reference

### Shared options (PR and branch)

| Flag | Description |
| --- | --- |
| `--quick` | Quick review: analyze diff only (default) |
| `--deep` | Deep review: explore the full codebase for cross-file impacts |
| `--verbose` | Show debug info including timing, model, and token counts |
| `--model <id>` | Claude model to use (`sonnet`, `opus`, `haiku`, or full model ID) |
| `--mode <mode>` | Review mode: `balanced`, `strict`, `detailed`, or `lenient` |
| `--html` | Generate standalone HTML diff report with inline annotations |

### PR-only options

| Flag | Description |
| --- | --- |
| `--post` | Post review as GitHub PR comments (created as pending) |

## Review modes

| Mode | What it does |
| --- | --- |
| `balanced` | The default. Good signal-to-noise - skips nitpicks, surfaces what matters. |
| `strict` | Bugs and security issues only. Nothing else. |
| `detailed` | The full picture: all categories, all severities, including nitpicks. |
| `lenient` | Relaxed. No nitpicks, higher bar before anything gets flagged. |

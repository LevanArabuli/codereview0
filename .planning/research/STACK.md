# Stack Research

**Domain:** Claude Code agent teams integration — Node.js CLI tool
**Researched:** 2026-03-05
**Confidence:** HIGH (verified against official Anthropic docs, Claude Code CLI reference, Agent SDK docs)

---

## Context

This research covers only the agent teams integration layer. The existing stack (TypeScript 5.9.3, Node.js 22+, commander, @octokit/rest, zod, picocolors, execFile/spawn subprocess model) is unchanged. The 4-runtime-dependency budget is a hard constraint.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env var | N/A | Enables agent teams in the Claude CLI | The only supported enable mechanism. Must be set in the environment passed to `filterEnv()` so the Claude subprocess sees it. Without it, the lead agent cannot spawn teammates. |
| `claude -p` subprocess (existing) | Claude Code v2.1.x | Lead agent invocation | The lead agent is invoked exactly like the current deep review mode: `spawn('claude', [...], { env: filterEnv() })`. No new tooling required for the invocation itself. |
| `--teammate-mode in-process` CLI flag | N/A | Disables tmux/iTerm2 split panes | This is a non-interactive CLI tool — tmux panes are unusable. `in-process` mode runs all teammates inside the lead's process, keeping stdout/stderr on the existing streams. Without this flag the default `auto` would silently fail to open tmux in CI or pipe contexts. |
| `Promise.all()` with four parallel `spawn` calls | Node.js built-in | Four aspect agents in parallel | DIY parallel subprocesses via `spawn` + `Promise.all` is the correct approach for this codebase. Each aspect (security, performance, quality, tests) gets its own `claude -p` subprocess. Results are independent JSON blobs collected and merged by the orchestrator. Does not require agent teams at all — see architecture decision note below. |

### Architecture Decision: Agent Teams vs DIY Parallel Subprocesses

**This is the central stack decision for this milestone.**

Two viable approaches exist:

**Option A: DIY Parallel Subprocesses (RECOMMENDED)**

Spawn four independent `claude -p` subprocesses in parallel using `Promise.all`. Each receives a specialized prompt (security reviewer, performance reviewer, etc.) and returns its own JSON findings. A fifth synthesis step or a simple merge handles deduplication.

- No new dependencies
- Stays within the existing execFile/spawn security model
- Each subprocess is isolated: timeout, credential scrubbing, and error handling apply independently
- No `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` needed
- Fully deterministic: four subprocesses always complete or fail independently
- Graceful degradation is trivial: if any subprocess fails, fall back to that aspect being skipped or using a single-agent review
- Token cost is identical (four sessions regardless of approach)
- No experimental feature instability

**Option B: Agent Teams (DEFERRED — conditional on user requirement)**

Invoke a single lead `claude` session with a prompt that instructs it to `Create an agent team with four specialist reviewers`. The lead spawns teammates through the agent teams mechanism. Requires:
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in the subprocess environment
- `--teammate-mode in-process` flag to prevent tmux/iTerm2 attempts
- The lead session coordinates via shared task list and mailbox
- Lead synthesizes findings when all four teammates complete
- The entire team's output arrives via the lead session's stdout stream

Agent teams are experimental (shipped February 2026 with Claude Opus 4.6, still gated behind env var). Known limitations include: no session resumption, task status can lag, shutdown can be slow, no nested teams. The coordination overhead is real: each teammate is a separate Claude instance with its own context window.

**Verdict:** Implement Option A (DIY parallel subprocesses) first. It is simpler, more reliable, fits the existing security model exactly, and delivers identical parallelism. If the user specifically needs inter-agent communication (teammates challenging each other's findings, shared task list, etc.), implement Option B as an additive layer. PROJECT.md states the preference is for agent teams API — validate with the user before assuming Option B is required.

---

### Supporting Libraries

No new runtime libraries required. The 4-dependency budget is preserved.

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.69 | TypeScript SDK for programmatic Claude Code invocation | Only if the codebase migrates away from subprocess invocation toward an SDK model. This is a **5th runtime dependency** — would require explicit user approval and breaks the dependency budget. The existing `execFile`/`spawn` model is fully capable. |

### Development Tools

No changes to existing development tooling (tsup, tsx, vitest, TypeScript).

---

## Installation

No new packages required for Option A (DIY parallel subprocesses):

```bash
# No installation needed — uses existing execFile/spawn + Node.js built-ins
```

If Option B (agent teams via SDK) is chosen and the dependency budget is expanded:

```bash
# Requires explicit dependency budget approval
npm install @anthropic-ai/claude-agent-sdk
```

---

## How to Invoke Agent Teams / Parallel Subprocesses

### Option A: DIY Parallel Subprocesses (fits existing codebase)

```typescript
// Four parallel claude -p invocations using existing spawn infrastructure
// Each subprocess gets a specialized prompt for its review aspect
const aspects = ['security', 'performance', 'quality', 'tests'];

const results = await Promise.all(
  aspects.map(aspect =>
    spawnClaudeForAspect(aspect, prData, clonePath, model, mode)
  )
);

// Merge findings: tag each with aspect, deduplicate by file+line+message
const mergedFindings = mergeAspectFindings(results);
```

Each `spawnClaudeForAspect` call is structurally identical to the existing `analyzeAgentic()` in `src/analyzer.ts`. The only differences are:
1. The prompt is aspect-specialized (e.g., "You are a security reviewer. Focus only on security vulnerabilities.")
2. The subprocess environment passes `filterEnv()` (unchanged)
3. Results are tagged with the aspect name before merging

### Option B: Agent Teams via Lead Prompt

```typescript
// Pass CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in the subprocess environment
const env = {
  ...filterEnv(),
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
};

// Spawn the lead agent with a prompt that instructs team creation
const args = [
  '-p', buildAgentTeamPrompt(prData, mode),
  '--output-format', 'stream-json',
  '--verbose',
  '--teammate-mode', 'in-process',  // CRITICAL: prevents tmux/iTerm2 attempts
  '--max-turns', String(MAX_AGENTIC_TURNS),
];
if (model) args.push('--model', model);

const child = spawn('claude', args, {
  cwd: clonePath,
  stdio: ['pipe', 'pipe', 'pipe'],
  env,
});
```

The lead session's output (via stdout stream-json) includes the final synthesis after all teammates complete. The existing `parseStreamResult()` and `parseClaudeResponse()` functions handle the output.

### Environment Variable Handling

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` must pass through `filterEnv()`. The current `filterEnv()` strips variables with the `KEY_` prefix — the agent teams var does not match any blocked prefix, so it passes through automatically when set in the environment.

To explicitly inject it for agent teams sessions only (not all sessions):

```typescript
function filterEnvForAgentTeams(): NodeJS.ProcessEnv {
  return {
    ...filterEnv(),
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
  };
}
```

This keeps `filterEnv()` unchanged (no new blocked prefixes, no accidental leaks).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| DIY parallel `spawn` calls (Option A) | Agent Teams via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | When inter-agent communication is required (teammates need to challenge each other's findings, share discoveries mid-task, or coordinate without a central orchestrator). Only viable if the experimental feature graduates to stable. |
| `spawn` with argument arrays | `@anthropic-ai/claude-agent-sdk` TypeScript library | If the codebase grows beyond subprocess orchestration, needs hooks/callbacks, or the dependency budget is expanded. The SDK bundles its own Claude Code executable and requires Node.js 18+, which fits this project's Node.js 22+ requirement. |
| Four independent subprocesses | Agent Teams with three-reviewer example from docs | Docs show a three-reviewer pattern; four is the project requirement. The approach is identical — just add a fourth specialized prompt. |
| Lead prompt-based agent team creation | `--agents` CLI flag for subagent definitions | `--agents` defines subagents (single-session, report back to caller). Agent teams require the CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var and the lead's natural-language prompt to create the team. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` without `--teammate-mode in-process` | The default `auto` mode will attempt to open tmux or iTerm2 split panes. In a non-interactive subprocess context (piped stdin, no TTY), this will fail silently or produce garbled output. | Always pair with `--teammate-mode in-process` when using agent teams in subprocess invocations. |
| `exec()` with string interpolation to pass the env var | Breaks the security invariant from SECURITY.md (SUB-01). `exec()` is never used anywhere in the codebase. | Pass `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1'` in the `env` option to `spawn()`. |
| `@anthropic-ai/claude-agent-sdk` as a 5th runtime dependency | Violates the 4-dependency budget. The SDK under the hood also uses subprocess invocation (`pathToClaudeCodeExecutable`). It adds ~1MB of dependencies for capabilities already achievable with `spawn`. | `spawn('claude', args, { env })` — the existing model is sufficient. |
| Agent subagents via `--agents` CLI flag (NOT the same as agent teams) | Subagents run within a single session and only report back to the main agent. They cannot message each other. This does not deliver true parallel independent review aspects. | Either DIY parallel subprocesses (Option A) or true agent teams via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (Option B). |
| Split-pane mode (`--teammate-mode tmux` or `--teammate-mode auto`) | Requires tmux or iTerm2 with Python API. Non-interactive CLI tools have no TTY. Will throw errors or silently fail. | `--teammate-mode in-process` for all programmatic/subprocess invocations. |
| Blocking on agent teams graduation from experimental | PROJECT.md explicitly requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. The feature shipped February 2026 and is usable today. Implement graceful fallback rather than waiting. | Check for agent teams availability at runtime; fall back to single-agent review if the env var is unset or the feature fails. |

---

## Stack Patterns by Variant

**If implementing Option A (DIY parallel subprocesses):**
- Extend `src/analyzer.ts` with `analyzeAspect(aspect, prData, clonePath, model, mode)` that calls `spawn` with a specialized prompt
- Add `analyzeParallel(prData, clonePath, model, mode)` that calls `Promise.all([analyzeAspect('security', ...), analyzeAspect('performance', ...), analyzeAspect('quality', ...), analyzeAspect('tests', ...)])`
- Timeout each aspect subprocess independently (10 minutes each, or proportionally reduced)
- Tag findings with `{ aspect: 'security' | 'performance' | 'quality' | 'tests' }` before merging
- No new env vars required

**If implementing Option B (agent teams):**
- Extend `filterEnv()` or create `filterEnvForAgentTeams()` to include `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1'`
- Pass `--teammate-mode in-process` to the lead subprocess
- Write a lead prompt that instructs: create a team with four reviewers (security, performance, quality, tests), have each review the PR independently, synthesize findings grouped by aspect
- The lead session's final result contains the synthesized findings — parse with existing `parseStreamResult()` and `parseClaudeResponse()`
- Add runtime detection: check if `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is set in `process.env`; if not, warn and fall back to single-agent review
- Increase timeout: agent team reviews will take longer than single-session reviews (4 independent context windows + synthesis)

**If graceful degradation is required (both options):**
- Check availability at startup: attempt to detect Claude CLI version or agent teams support
- Alternatively, attempt team review and catch failure; fall back to single-agent `analyzeAgentic()`
- Log a clear warning: "Agent teams unavailable (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS not set). Falling back to single-agent review."

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Claude Code CLI v2.1.x | Node.js 22+ | Agent teams shipped in v2.1.32. `--teammate-mode` flag added in the same release. The `--agents` flag (for subagents, different from teams) is stable. |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | Claude Code CLI >= v2.1.32 | Feature flag enabled by env var. Not available in earlier versions. No explicit version check in the CLI — setting the var on older CLI simply has no effect. |
| `@anthropic-ai/claude-agent-sdk` 0.2.69 | Node.js 18+ | Bundles its own Claude Code CLI at `pathToClaudeCodeExecutable`. Does NOT require a separately installed `claude` binary. This is the key difference from the subprocess model: SDK ships its own binary. |
| Existing `spawn`/`execFile` subprocess model | Claude Code CLI v1.x, v2.x | The existing interface (`claude -p`, `--output-format stream-json`, `--verbose`) is stable across major versions. Support for both v1.x (`cost_usd`) and v2.x (`total_cost_usd`) metadata is already in `src/analyzer.ts`. |

---

## Key Environment Variables

| Variable | Value | Purpose | Where Set |
|----------|-------|---------|-----------|
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `1` | Enables agent teams feature in Claude CLI | Must be present in the `env` object passed to `spawn()`. NOT in `process.env` globally (would affect all subprocesses). Inject per-session for agent team invocations only. |
| `ANTHROPIC_API_KEY` | User-provided | Required by Claude CLI subprocess | Already in `filterEnv()` KEEP_LIST. No change needed. |
| `GH_TOKEN` / `GITHUB_TOKEN` | User-provided | Required for GitHub API and gh CLI | Already in `filterEnv()` KEEP_LIST. No change needed. |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | `1` | Disables background task functionality in Claude | Optional. Set if background task interference is observed during parallel subprocess runs. |

---

## Sources

- [Official Claude Code agent teams docs](https://code.claude.com/docs/en/agent-teams) — HIGH confidence: architecture, enable mechanism, limitations, display modes, `--teammate-mode` flag
- [Official Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents) — HIGH confidence: subagents vs agent teams distinction, `--agents` CLI flag format
- [Official Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) — HIGH confidence: `--teammate-mode`, `--agents`, `--output-format`, all flag definitions
- [Official Claude Code headless/programmatic docs](https://code.claude.com/docs/en/headless) — HIGH confidence: `-p` flag, `--output-format json/stream-json`, Agent SDK overview
- [Agent SDK overview docs](https://platform.claude.com/docs/en/agent-sdk/overview) — HIGH confidence: TypeScript SDK `query()` API, `agents` option for programmatic subagents, `env` option
- [Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — HIGH confidence: `Options` type, `env` field, `pathToClaudeCodeExecutable`, all options
- [Agent SDK quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart) — HIGH confidence: Node.js 18+ requirement, SDK bundles Claude Code executable
- [anthropics/claude-agent-sdk-typescript GitHub](https://github.com/anthropics/claude-agent-sdk-typescript) — HIGH confidence: current version 0.2.69, CHANGELOG

---

*Stack research for: Claude Code agent teams integration into codereview0 CLI*
*Researched: 2026-03-05*

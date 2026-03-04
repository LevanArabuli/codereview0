# Stack Research

**Domain:** AI-powered code review quality improvement (prompt engineering, context gathering, structured output)
**Researched:** 2026-03-04
**Confidence:** HIGH

## Executive Summary

The quality improvement milestone requires **zero new runtime dependencies**. Everything needed is achievable through:

1. Better prompt structure in `src/prompt.ts` — XML tags, chain-of-thought separation, few-shot examples, explicit conventions-detection step
2. Context gathering via Node.js built-ins and existing `@octokit/rest` calls already in the budget
3. The existing Zod schemas already support confidence scoring — the schema already has `confidence: "high"|"medium"|"low"` and `category` fields
4. Structured JSON output is already enforced via prompt instruction + Zod validation in `parseClaudeResponse()`

The native Claude API structured outputs feature (`output_config.format` with JSON Schema constrained decoding) is **NOT applicable** — the tool invokes the Claude CLI as a subprocess (`claude -p`), not the Anthropic SDK. The CLI does not expose `output_config`. The existing prompt-based JSON enforcement + Zod retry is the correct pattern for this architecture.

---

## Recommended Stack

### Core Technologies (Unchanged)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| TypeScript | 5.9.x | Language | Already in use. Strict mode enforced. |
| Node.js | >=22 | Runtime | Already required. Built-in `fs`, `path`, `child_process` cover all context-gathering needs. |
| Zod | 4.3.x | Schema validation | Already in use. `ReviewFindingSchema` already validates `confidence`, `severity`, `category`. |
| `@octokit/rest` | 22.x | GitHub API | Already in use. Can fetch related file contents for context enrichment with zero changes to dependency budget. |

### Supporting Libraries (No New Runtime Dependencies Required)

The entire quality improvement scope is achievable within the existing 4-dependency budget. The table below shows what each quality improvement technique requires and confirms no new dependency is needed.

| Improvement Technique | Required Capability | Already Available? | How |
|----------------------|--------------------|--------------------|-----|
| Convention-detection step in deep mode | Read existing files, detect patterns | YES | Claude already has file system access via the agentic tools (`Bash`, `Read`). The prompt instructs it where to look. |
| PR intent extraction | Parse PR title, body, branch name | YES | `PRData` type already carries all fields |
| Few-shot examples in prompt | Static string in `prompt.ts` | YES | String template in `buildPrompt()` / `buildAgenticPrompt()` |
| Chain-of-thought before JSON output | XML `<thinking>` tag wrapping in prompt, strip before parsing | YES | Built-in string manipulation. The regex fallback in `parseClaudeResponse()` already handles surrounding text. |
| Confidence scoring | `confidence` field in `ReviewFindingSchema` | YES | Already exists in the schema |
| Severity calibration instructions | Prompt text | YES | `MODE_OVERLAYS` already exists, needs expansion |
| Context file fetching (quick mode) | `octokit.repos.getContent()` | YES | `@octokit/rest` already in budget |
| Noise suppression | Prompt instruction + post-filter in output layer | YES | `src/output.ts` and prompt overlays |

---

## Alternatives Considered

| Area | Considered | Why Not |
|------|------------|---------|
| Native Claude API structured outputs (`output_config.format`) | Provides constrained decoding, eliminates JSON parse failures | **Not applicable**: requires Anthropic SDK, not available through `claude -p` CLI subprocess. The tool must stay CLI-based to preserve the existing auth model and security architecture. |
| `@anthropic-ai/sdk` as new dependency | Would enable direct API calls + structured outputs | Exceeds 4-dep budget; requires new auth flow (ANTHROPIC_API_KEY vs gh CLI token); significantly changes architecture; not justified when existing approach works. |
| `typescript` compiler API for AST analysis | Deep codebase pattern extraction | Would add ~5-15MB dev dependency to runtime bundle; TypeScript is already a devDependency but runtime AST parsing adds size and complexity. Better approach: have Claude (which has full codebase access in deep mode) do the convention detection itself via natural language exploration. |
| `@typescript-eslint/parser` for convention extraction | Extract naming patterns, error handling conventions | Requires new runtime dependency (~3MB); overkill when Claude can read source files directly in deep mode. |
| `jscodeshift` / `babel-parser` for AST | Codebase analysis | Heavy dependencies. Same reasoning: Claude's agentic tools (Bash + Read) can do the analysis in deep mode without adding runtime deps. |
| Prompt caching via Anthropic API | Reduce cost for repeated system prompts | Requires `@anthropic-ai/sdk`; not accessible from CLI subprocess interface. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@anthropic-ai/sdk` runtime dependency | Adds a 5th runtime dep; requires API key auth separate from `gh` CLI token; breaks the existing security model where `ANTHROPIC_API_KEY` is optional (CLI handles it); significant architecture change | Existing `claude -p` CLI subprocess pattern |
| `typescript` as a runtime dep (not devDep) | AST parsing at runtime adds weight; Claude can analyze conventions directly when it has file system access in deep mode | Deep mode agentic instructions for convention detection |
| `highlight.js` or similar | Explicitly out of scope per PROJECT.md constraints | No syntax highlighting needed |
| `langchain` / `llamaindex` / prompt libraries | Heavy frameworks; overkill for prompt string construction; adds dependencies and complexity | Plain TypeScript string templates in `src/prompt.ts` |
| Prefilled assistant responses | Deprecated in Claude 4.6 models — prefill on last assistant turn no longer supported | Prompt instruction: "Respond with ONLY a valid JSON object..." |

---

## Prompt Engineering Patterns (The Core "Stack" Change)

The real stack change for this milestone is **prompt engineering patterns**. These are pure string-template changes in `src/prompt.ts` with no new dependencies.

### Pattern 1: Two-Phase XML Structure (HIGH confidence)

**Source:** Anthropic official docs (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags)

Separate reasoning from output. Claude is better calibrated when it reasons before producing structured data. Wrap thinking in `<thinking>` tags so the regex fallback in `parseClaudeResponse()` ignores it.

```typescript
// In buildPrompt() / buildAgenticPrompt()
const THINKING_INSTRUCTION = `Before producing the JSON output, think through your analysis inside <thinking> tags:
- What is this PR trying to accomplish?
- What are the most significant risks in the changed code?
- For each potential finding: is this a real issue or a style preference?
- What confidence level does each finding merit, and why?

After your analysis, output ONLY the JSON object with no surrounding text.`;
```

The existing `parseClaudeResponse()` regex `resultText.match(/\{[\s\S]*"findings"[\s\S]*\}/)` already handles stripping surrounding XML tags.

**Why this matters:** Chain-of-thought before structured output improves judgment accuracy. Claude thinks through whether something is a real issue vs. a nit before committing to a severity/confidence level. Structured Chain-of-Thought (SCoT) prompting outperforms basic CoT by up to 13.79% on coding tasks (ACM TOSEM, 2025).

### Pattern 2: Convention Detection Phase in Deep Mode (HIGH confidence)

**Source:** Anthropic prompt engineering guide, verified against codebase architecture

Add an explicit convention-detection step to `buildAgenticPrompt()` before the diff analysis:

```typescript
const CONVENTION_DETECTION_STEP = `## Phase 1: Understand Codebase Conventions (Before Reviewing the Diff)

Before examining the diff, read 2-4 representative non-changed source files to understand established patterns:
- Error handling approach (thrown exceptions vs. returned error objects vs. Result types)
- Naming conventions (camelCase, snake_case, prefix patterns)
- Common abstractions and utilities already in the codebase
- Test structure and coverage expectations

Only look for patterns with 2+ consistent instances across files. Do NOT invent conventions from single examples.

Record what you find as: "This codebase uses [pattern] — e.g., all async errors use thrown exceptions with custom error classes."

Use this understanding to calibrate your review: if the diff follows existing patterns, do not flag them. If the diff diverges from clear patterns, flag it as a pattern violation.`;
```

Claude's agentic tools (Bash, Read) already provide full filesystem access in deep mode. This is instructional change only — no new capabilities needed.

### Pattern 3: Intent-First PR Analysis (HIGH confidence)

Add PR intent extraction at the top of both prompts to ground the entire review:

```typescript
const INTENT_EXTRACTION = `## PR Intent

Based on the title, description, and changed files, state in one sentence what this PR is trying to accomplish. Use this as your lens for the entire review — every finding should be evaluated against whether it matters for this specific goal.

Example: "This PR migrates the auth module from session cookies to JWT tokens."`;
```

This prevents findings that are technically valid but irrelevant to the PR's purpose.

### Pattern 4: Confidence Calibration Instructions (MEDIUM confidence)

The `confidence` field already exists in `ReviewFindingSchema`. The prompt needs explicit calibration guidance:

```typescript
const CONFIDENCE_GUIDANCE = `Confidence calibration:
- "high": You can point to a specific code path that will fail or a clear violation of an established pattern with 2+ examples in the codebase
- "medium": The issue is likely real but depends on runtime behavior you cannot verify from static analysis, or the pattern exists but has only 1 clear precedent
- "low": The issue is possible but you're reasoning from general software engineering principles rather than codebase evidence

Omit findings where confidence would be "low" and severity would be "suggestion" or "nitpick". These are not worth human attention.`;
```

This directly addresses the false positive / noise problem without adding filtering code — the model self-filters based on the rubric.

### Pattern 5: Few-Shot Examples for Severity Calibration (MEDIUM confidence)

**Source:** Anthropic docs recommend 3-5 examples for "best results"; academic research shows few-shot is the most effective method for LLM code quality improvement

Add one concrete good/bad example pair to each severity level description in `FINDING_FORMAT_INSTRUCTIONS` to anchor Claude's judgment:

```typescript
// In FINDING_FORMAT_INSTRUCTIONS
const SEVERITY_EXAMPLES = `Severity examples:
- bug (HIGH bar): "This loop exits early due to a missing await" or "parseInt() returns NaN when input is undefined, breaking the downstream calculation"
- security (HIGH bar): "User input is passed directly to a shell command via string interpolation"
- suggestion (MEDIUM bar): "This function is called in 3 places and the error handling is inconsistent with the pattern in the other 2 callers"
- nitpick (LOW bar, omit in balanced/strict/lenient modes): "Variable name could be more descriptive"

NOT a bug: "This might fail if the database is down" (too speculative without evidence)
NOT a suggestion: "Consider using a different data structure" (vague, no concrete benefit shown)`;
```

---

## Context Enrichment via Existing Octokit

For quick mode (diff only), use the already-budgeted `@octokit/rest` to fetch related file context:

```typescript
// Using octokit.repos.getContent() — already in the 4-dep budget
// Fetch the full file content for up to 3 changed files to provide broader context
const fileContexts = await Promise.all(
  prData.files.slice(0, 3).map(f =>
    octokit.repos.getContent({ owner, repo, path: f.filename, ref: prData.baseBranch })
  )
);
```

This gives quick mode access to the surrounding context of changed functions without requiring a clone. No new dependencies.

**Constraint:** Only the GitHub API is available for quick mode context. Keep to 3 files max to stay within context window limits. Each file adds to the prompt size — truncate to 200 lines max per file.

---

## Schema Changes Required

The existing `ReviewFindingSchema` is nearly complete for this milestone. One addition is justified:

```typescript
// Current schema is sufficient for confidence scoring — already has:
// - confidence: z.enum(['high', 'medium', 'low'])
// - category: z.string()
// - severity: z.enum(['bug', 'security', 'suggestion', 'nitpick'])

// Potential addition to support intent-aware reviews:
// prIntent: z.string().optional()  // in ReviewResultSchema, not per-finding
// — captures Claude's stated intent for the overall review summary
```

The `ReviewResultSchema` wrapping `findings` array could add a top-level `summary` field to capture the PR intent extraction:

```typescript
export const ReviewResultSchema = z.object({
  findings: z.array(ReviewFindingSchema),
  summary: z.string().optional(),  // Claude's one-sentence PR intent statement
});
```

This is purely additive (`.optional()`) — no breaking change to existing parsing.

---

## Version Compatibility

| Package | Current Version | Notes |
|---------|-----------------|-------|
| `zod` | ^4.3.6 | Zod 4 API is confirmed in use. `.optional()` and `.enum()` behave identically to Zod 3 for this use case. |
| `@octokit/rest` | ^22.0.1 | `repos.getContent()` has been stable since v18. Confirmed available. |
| `commander` | ^14.0.3 | No changes needed. |
| `picocolors` | ^1.1.1 | No changes needed. |

---

## Installation

No new packages to install. All improvements are prompt engineering and code changes within existing modules.

```bash
# No new dependencies — existing stack handles everything
# Verify current deps are up to date:
npm install
```

---

## Sources

- Anthropic official prompt engineering guide (verified 2026-03-04): https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
  — XML tags, chain-of-thought, few-shot examples, output formatting
- Anthropic structured outputs docs (verified 2026-03-04): https://platform.claude.com/docs/en/build-with-claude/structured-outputs
  — Confirmed `output_config.format` is API-only, not CLI-accessible. MEDIUM confidence on CLI limitation (documented gap, not explicit statement).
- Anthropic prompt engineering XML tags (HIGH confidence): https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags
  — XML tag structure, `<thinking>` tags for chain-of-thought
- Structured Chain-of-Thought for Code, ACM TOSEM 2025 (MEDIUM confidence, single academic source): https://dl.acm.org/doi/10.1145/3690635
  — 13.79% improvement on HumanEval vs. standard CoT
- Fine-Tuning and Prompt Engineering for LLM Code Review, arXiv 2024 (MEDIUM confidence): https://arxiv.org/pdf/2402.00905
  — Few-shot learning is the leading method for LLM code review automation
- Effective prompt engineering for AI code reviews, Graphite (MEDIUM confidence): https://graphite.com/guides/effective-prompt-engineering-ai-code-reviews
  — Context-first, severity-driven patterns
- Codebase analysis — existing `src/prompt.ts`, `src/analyzer.ts`, `src/schemas.ts` (HIGH confidence, first-party source)

---
*Stack research for: AI code review quality improvement milestone*
*Researched: 2026-03-04*

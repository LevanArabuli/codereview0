import type { PRData } from './types.js';

/** Valid review mode strings */
export const REVIEW_MODES = ['strict', 'detailed', 'lenient', 'balanced'] as const;

/** A review mode that controls the scope and thoroughness of findings */
export type ReviewMode = typeof REVIEW_MODES[number];

/** Maximum diff size in characters before truncation (~80KB, safe for Claude context window) */
const MAX_DIFF_CHARS = 80_000;

/**
 * Truncate a diff to fit within the Claude context window.
 * Returns the original diff if within limits, or a truncated version with a warning.
 */
function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) {
    return diff;
  }
  const truncated = diff.slice(0, MAX_DIFF_CHARS);
  // Try to cut at the last complete file boundary (diff --git line)
  const lastFileBoundary = truncated.lastIndexOf('\ndiff --git');
  const cutPoint = lastFileBoundary > MAX_DIFF_CHARS * 0.5 ? lastFileBoundary : MAX_DIFF_CHARS;
  return truncated.slice(0, cutPoint) + '\n\n[... diff truncated — remaining files omitted due to size. Focus review on the files shown above.]';
}

/** Prompt overlay paragraphs for each review mode, appended after the base prompt */
const MODE_OVERLAYS: Record<ReviewMode, string> = {
  strict: `\n\nREVIEW MODE — STRICT: Focus exclusively on bugs, security vulnerabilities, and critical suggestions that could cause real problems if ignored (race conditions, data loss risks, resource leaks). Do NOT report regular code quality suggestions, style preferences, or nitpicks. Only report findings with severity "bug", "security", or "suggestion" where the suggestion addresses a critical risk. If in doubt whether a suggestion is critical, omit it.`,

  detailed: `\n\nREVIEW MODE — DETAILED: Provide a thorough, comprehensive review covering ALL categories. Include nitpicks and minor style observations — mark each nitpick finding clearly with severity "nitpick" so users can scan past them. Be exhaustive: report every issue you notice, no matter how small.`,

  lenient: `\n\nREVIEW MODE — LENIENT: Report bugs and security issues as normal. For suggestions, apply a high bar — only include suggestions that represent significant improvements to correctness, performance, or maintainability. Skip minor suggestions, style preferences, and anything that is "nice to have" but not impactful. Do NOT report nitpicks at all. When uncertain whether a suggestion meets the bar, omit it.`,

  balanced: `\n\nREVIEW MODE — BALANCED: Report bugs and security issues as normal. Include suggestions that represent meaningful improvements to readability, maintainability, performance, or design.

Do NOT report:
- File formatting issues (trailing newlines, whitespace, indentation)
- Idiomatic language/framework patterns (prop spreading in React, defensive ARIA attributes, common conventions) unless they cause a concrete bug
- Theoretical concerns without evidence of actual breakage in the codebase

Before including a suggestion, ask: "Would a senior engineer consider this worth commenting on in a code review?" If the answer is no, omit it.

Focus on being a helpful colleague: flag what matters, skip what doesn't.`,
};

/**
 * Per-finding field definitions shared between buildPrompt() and buildAgenticPrompt().
 * Extracted to prevent drift between quick and agentic prompt output formats.
 */
const FINDING_FORMAT_INSTRUCTIONS = `For each issue found, provide:
- file: the file path exactly as shown in the diff
- line: the line number in the new version of the file where the issue occurs
- endLine: (optional) if the issue spans multiple lines, the ending line number
- severity: one of "bug", "security", "suggestion", or "nitpick"
  - bug: logic errors, crashes, incorrect behavior, off-by-one errors, race conditions
  - security: injection vulnerabilities, auth issues, data exposure, insecure patterns
  - suggestion: meaningful improvements to readability, maintainability, performance, or design
  - nitpick: minor style preferences or trivial observations
- confidence: "high", "medium", or "low" -- how confident you are this is a real issue
- category: a short tag describing the issue type (e.g., "null-safety", "race-condition", "sql-injection", "error-handling", "naming")
- description: 2-4 sentences explaining the problem AND suggesting how to fix it. Be specific and constructive.
- suggestedFix: (optional) for simple fixes only (null checks, missing imports, simple corrections), provide the corrected code. Omit for complex changes.
- relatedLocations: (optional) array of other locations in the diff related to this issue, each with file, line, and reason`;

/**
 * JSON response instruction shared between buildPrompt() and buildAgenticPrompt().
 * Extracted to prevent drift between quick and agentic prompt output formats.
 */
const JSON_RESPONSE_INSTRUCTION = `IMPORTANT: Respond with ONLY a valid JSON object matching this exact structure — no explanation, no markdown, no tool calls:
{"findings": [{"file": "string", "line": number, "severity": "bug"|"security"|"suggestion"|"nitpick", "confidence": "high"|"medium"|"low", "category": "string", "description": "string"}]}
Optional fields per finding: "endLine" (number), "suggestedFix" (string), "relatedLocations" ([{"file": "string", "line": number, "reason": "string"}])`;

/**
 * Get the prompt overlay text for a given review mode.
 * The overlay is appended to both quick and deep prompts identically.
 */
export function getModeOverlay(mode: ReviewMode): string {
  return MODE_OVERLAYS[mode];
}

/**
 * Build a complete review prompt from PR data for Claude CLI analysis.
 *
 * The prompt includes a reviewer persona, PR metadata in XML tags,
 * the raw unified diff, finding format instructions, and scope guidance.
 */
export function buildPrompt(prData: PRData, mode?: ReviewMode): string {
  const description = prData.body || '(no description provided)';

  const basePrompt = `You are an experienced software engineer reviewing a pull request. Your role is to be a helpful, constructive colleague -- not a pedantic gatekeeper. Focus on issues that matter: bugs, security vulnerabilities, logic errors, and meaningful code quality improvements.

Review the following pull request diff and identify any issues.

<pr_metadata>
Title: ${prData.title}
Description: ${description}
Branch: ${prData.headBranch} -> ${prData.baseBranch}
Changed files: ${prData.changedFiles} (+${prData.additions} -${prData.deletions})
</pr_metadata>

<diff>
${truncateDiff(prData.diff)}
</diff>

${FINDING_FORMAT_INSTRUCTIONS}

Focus on the CHANGED code (lines with + prefix in the diff). Only flag issues in unchanged context lines if they are directly affected by the changes.

Report all issues you find. Do not filter or limit the count. If you find no issues, return an empty findings array.

If test files appear in the diff alongside source files, briefly assess whether the test changes adequately cover the source changes. If source files are changed but related test files in the diff appear to have insufficient coverage for the changes, mention this as a suggestion. Only observe test coverage for files actually present in the diff -- do not speculate about test files not included in the diff.

${JSON_RESPONSE_INSTRUCTION}`;

  const effectiveMode = mode ?? 'balanced';
  return basePrompt + getModeOverlay(effectiveMode);
}

/**
 * Build a unified agentic prompt that guides Claude to both analyze the PR diff
 * AND explore the codebase for cross-file issues in a single session.
 *
 * CLI flag verification (Phase 11, verified against Claude CLI v2.1.47):
 * --append-system-prompt: EXISTS -- appends to default system prompt, documented in --help
 * --max-budget-usd: EXISTS -- maximum dollar spend for API calls, only works with --print
 * --max-turns: UNDOCUMENTED -- not listed in --help output, but functional; already used in analyzer.ts (lines 78-79, 173)
 * --tools: EXISTS -- specifies available built-in tools (e.g. "Bash,Edit,Read"), already used in analyzer.ts
 */
export function buildAgenticPrompt(prData: PRData, mode?: ReviewMode): string {
  const description = prData.body || '(no description provided)';
  const changedFileList = prData.files.map(f => `- ${f.filename} (${f.status}: +${f.additions} -${f.deletions})`).join('\n');

  const basePrompt = `You are a senior software engineer performing a thorough code review of a pull request. You have full access to the codebase. Your role is to be a helpful, constructive colleague -- not a pedantic gatekeeper. Focus on issues that matter: bugs, security vulnerabilities, logic errors, and meaningful code quality improvements.

Read the diff carefully, then explore the codebase to understand how these changes interact with existing code.

<pr_metadata>
Title: ${prData.title}
Description: ${description}
Branch: ${prData.headBranch} -> ${prData.baseBranch}
Changed files: ${prData.changedFiles} (+${prData.additions} -${prData.deletions})
</pr_metadata>

<changed_files>
${changedFileList}
</changed_files>

<diff>
${truncateDiff(prData.diff)}
</diff>

## Review Instructions

Read the diff above thoroughly and identify all issues in the changed code before beginning any codebase exploration. Complete your diff analysis first — only then explore cross-file implications. Focus on the CHANGED code (lines with + prefix in the diff). Only flag issues in unchanged context lines if they are directly affected by the changes.

${FINDING_FORMAT_INSTRUCTIONS}

Report all issues you find. Do not filter or limit the count. If you find no issues, return an empty findings array.

If a fix requires changes beyond the scope of this PR (e.g., a broader refactoring effort across multiple components), frame it as a follow-up recommendation rather than a targeted suggestion. Do not flag issues that cannot be meaningfully addressed within this PR alone.

## Codebase Exploration

After reviewing the diff, explore the codebase to find issues that are invisible from the diff alone. You decide where to look and when to stop based on what the diff tells you.

Look for:
- **Broken callers**: Functions or APIs whose signature or behavior changed in the diff, but consumers elsewhere still expect the old contract
- **Pattern violations**: Changes that diverge from established codebase conventions (a pattern requires 2-3 instances in the codebase to be considered established)
- **Duplication**: The PR introduces code that already exists elsewhere in the codebase
- **Test coverage gaps**: Discover and read test files to assess whether the changed code has adequate test coverage

Exploration is unlimited -- there are no artificial limits on how many files you read. Read the diff first, then decide which exploration categories are most relevant. Stop exploring when further investigation is unlikely to reveal new issues.

Every cross-file finding MUST reference specific files and lines as evidence -- verifiable claims only. Every cross-file finding MUST include relatedLocations connecting back to the PR changes that caused the issue.

## Output Format

Present findings in a SINGLE JSON array. Place diff-visible findings first in the array, followed by cross-file findings discovered through exploration. Both use the identical schema above.

${JSON_RESPONSE_INSTRUCTION}`;

  const effectiveMode = mode ?? 'balanced';
  return basePrompt + getModeOverlay(effectiveMode);
}

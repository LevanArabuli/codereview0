import type { PRData, PRFile, ReviewContext, RelatedFile } from './types.js';

/** Valid review mode strings */
export const REVIEW_MODES = ['strict', 'detailed', 'lenient', 'balanced'] as const;

/** A review mode that controls the scope and thoroughness of findings */
export type ReviewMode = typeof REVIEW_MODES[number];

/** PR intent categories for review calibration */
export type PRIntent = 'feature' | 'bugfix' | 'refactor' | 'dependency' | 'docs-config' | 'unknown';

/**
 * Extract the intent of a PR from its title and body.
 * Checks in priority order: bugfix > refactor > dependency > docs-config > feature.
 * Falls back to body analysis if title yields 'unknown'.
 */
export function extractIntent(title: string, body: string): PRIntent {
  const lower = title.toLowerCase();

  // Priority 1: Bugfix
  if (/^fix[:(\/]/.test(lower) || /\bfix(?:es|ed)?\b|\bbug\b|\bhotfix\b|\bpatch\b/.test(lower)) {
    return 'bugfix';
  }

  // Priority 2: Refactor
  if (/^refactor[:(\/]/.test(lower) || /\brefactor\b|\bcleanup\b|\brestructure\b|\breorganize\b/.test(lower)) {
    return 'refactor';
  }

  // Priority 3: Dependency
  if (/^chore[:(\/].*(?:dep|bump|upgrade|version)/i.test(lower) ||
      /\bbump\b|\bdep(?:endenc(?:y|ies))?\b|\bupgrade\b/.test(lower) ||
      /\bupdate\b.*(?:version|package|dep)/.test(lower)) {
    return 'dependency';
  }

  // Priority 4: Docs-config
  if (/^docs[:(\/]/.test(lower) ||
      /\bdocs?\b|\bdocument(?:ation)?\b|\breadme\b/.test(lower) ||
      /\bconfig\b|\bci\b/.test(lower) ||
      (/^chore[:(\/]/.test(lower) && /\bdocs?\b|\bci\b/.test(lower))) {
    return 'docs-config';
  }

  // Priority 5: Feature
  if (/^feat[:(\/]/.test(lower) || /\bfeat(?:ure)?\b|\badd\b|\bimplement\b|\bintroduce\b|\bnew\b/.test(lower)) {
    return 'feature';
  }

  // Body fallback: use stricter patterns on combined title+body
  if (body) {
    const combined = (title + ' ' + body).toLowerCase();
    if (/\bfix(?:es|ed)?\b/.test(combined) && /\bbug\b/.test(combined)) return 'bugfix';
    if (/\bfix(?:es|ed)?\b/.test(combined)) return 'bugfix';
    if (/\brefactor\b/.test(combined)) return 'refactor';
    if (/\badd(?:s|ed)?\b.*\bfeature\b|\bfeat(?:ure)?\b|\bintroduce\b|\bimplement\b/.test(combined)) return 'feature';
  }

  return 'unknown';
}

/**
 * Generate intent-specific flagging guidance for the review prompt.
 * Returns empty string for 'unknown' intent (no guidance injected).
 * Every non-unknown category includes the bugs/security safety clause.
 */
function getIntentGuidance(intent: string): string {
  const SAFETY_CLAUSE = 'Bugs and security issues are ALWAYS reported regardless of PR intent.';

  switch (intent) {
    case 'bugfix':
      return `\n\nPR INTENT -- BUG FIX: This PR is fixing a bug. Focus on whether the fix is correct and complete -- does it address the root cause or just the symptom? Check for edge cases the fix might miss and whether the fix introduces any regressions. Suggestions about code style or refactoring are lower priority unless they affect correctness. ${SAFETY_CLAUSE}`;

    case 'refactor':
      return `\n\nPR INTENT -- REFACTOR: This PR is refactoring existing code. The primary concern is behavioral preservation -- flag any changes that alter observable behavior. Do not flag "missing tests for new behavior" since refactors should not introduce new behavior. Focus on whether the refactoring maintains correctness, preserves the API contract, and does not introduce subtle behavioral changes. ${SAFETY_CLAUSE}`;

    case 'feature':
      return `\n\nPR INTENT -- FEATURE: This PR adds new functionality. Focus on correctness of the new code, edge case handling, error handling, and whether the feature integrates well with existing code. Check for missing input validation, unhandled error paths, and test coverage for the new behavior. ${SAFETY_CLAUSE}`;

    case 'dependency':
      return `\n\nPR INTENT -- DEPENDENCY UPDATE: This PR updates dependencies. Focus on breaking API changes, deprecated usage patterns, and compatibility issues. Check if any code changes are needed to accommodate the updated dependency API. Style suggestions are not relevant for dependency updates. ${SAFETY_CLAUSE}`;

    case 'docs-config':
      return `\n\nPR INTENT -- DOCS/CONFIG: This PR updates documentation or configuration. Focus on accuracy of documentation, correctness of configuration values, and whether config changes could affect runtime behavior. Code style suggestions are not relevant. ${SAFETY_CLAUSE}`;

    default:
      return '';
  }
}

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

Concrete examples of what NOT to flag:

This is NOT a finding -- TypeScript already catches unused variables:
\`\`\`
const unused = getValue();
// TS error: 'unused' is declared but its value is never read (ts6133)
\`\`\`

This is NOT a finding -- missing return type on a private method:
\`\`\`
private calculateTotal(items: Item[]) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
\`\`\`

This is NOT a finding -- implicit any that TypeScript strict mode catches:
\`\`\`
function process(data) { // TS error: Parameter 'data' implicitly has an 'any' type (ts7006)
  return data.value;
}
\`\`\`

This is NOT a finding -- trailing newline at end of file:
A file ending with or without a trailing newline is not a code quality issue.

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
 * Few-shot severity anchoring examples shared between buildPrompt() and buildAgenticPrompt().
 * Extracted to prevent drift -- both quick and agentic prompts show identical examples.
 */
const SEVERITY_EXAMPLES = `Here are examples of correctly labeled findings at each severity level:

**bug** -- Observable incorrect behavior:
\`\`\`
const users = await db.query("SELECT * FROM users WHERE active = true");
return users[0].name; // crashes if query returns empty array
\`\`\`
{"severity": "bug", "confidence": "high", "category": "null-safety", "description": "Array access without bounds check. db.query may return an empty array, causing TypeError on .name access. Add a length check or use optional chaining."}

**security** -- Exploitable vulnerability:
\`\`\`
const query = "SELECT * FROM users WHERE id = " + userId;
\`\`\`
{"severity": "security", "confidence": "high", "category": "sql-injection", "description": "String concatenation in SQL query allows injection. Use parameterized queries instead."}

**suggestion** -- Meaningful improvement:
\`\`\`
let result = [];
for (const item of items) {
  if (item.active) result.push(item.name);
}
\`\`\`
{"severity": "suggestion", "confidence": "medium", "category": "readability", "description": "Imperative filter+map loop can be replaced with items.filter(i => i.active).map(i => i.name) for clarity."}

**nitpick** -- Minor style observation:
\`\`\`
import { readFile } from 'fs/promises';
import { join } from 'path'; // unused in this file
\`\`\`
{"severity": "nitpick", "confidence": "high", "category": "unused-import", "description": "The 'join' import from 'path' appears unused. Remove it to keep imports clean."}`;

/**
 * JSON response instruction shared between buildPrompt() and buildAgenticPrompt().
 * Extracted to prevent drift between quick and agentic prompt output formats.
 */
const JSON_RESPONSE_INSTRUCTION = `IMPORTANT: Respond with ONLY a valid JSON object matching this exact structure — no explanation, no markdown, no tool calls:
{"findings": [{"file": "string", "line": number, "severity": "bug"|"security"|"suggestion"|"nitpick", "confidence": "high"|"medium"|"low", "category": "string", "description": "string"}]}
Optional fields per finding: "endLine" (number), "suggestedFix" (string), "relatedLocations" ([{"file": "string", "line": number, "reason": "string"}])`;

/**
 * Format related files as XML tags for injection into the prompt.
 * Returns empty string if files array is empty.
 */
function formatRelatedFiles(files: RelatedFile[]): string {
  if (files.length === 0) return '';

  const tags = files.map(f =>
    `<related_file path="${f.path}" reason="${f.reason}">\n${f.content}\n</related_file>`
  ).join('\n\n');

  return `\nThe following related files from the codebase provide additional context. Use them to understand how the changed code fits into the larger system:\n\n${tags}\n`;
}

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
export function buildPrompt(prData: PRData, mode?: ReviewMode, context?: ReviewContext): string {
  const description = prData.body || '(no description provided)';

  const relatedFilesSection = context?.relatedFiles ? formatRelatedFiles(context.relatedFiles) : '';
  const intentGuidance = context?.intent ? getIntentGuidance(context.intent) : '';

  const basePrompt = `You are an experienced software engineer reviewing a pull request. Your role is to be a helpful, constructive colleague -- not a pedantic gatekeeper. Focus on issues that matter: bugs, security vulnerabilities, logic errors, and meaningful code quality improvements.

Review the following pull request diff and identify any issues.

<pr_metadata>
Title: ${prData.title}
Description: ${description}
Branch: ${prData.headBranch} -> ${prData.baseBranch}
Changed files: ${prData.changedFiles} (+${prData.additions} -${prData.deletions})
</pr_metadata>
${intentGuidance}

<diff>
${truncateDiff(prData.diff)}
</diff>
${relatedFilesSection}
${FINDING_FORMAT_INSTRUCTIONS}

${SEVERITY_EXAMPLES}

Focus on the CHANGED code (lines with + prefix in the diff). Only flag issues in unchanged context lines if they are directly affected by the changes.

Report all issues you find. Do not filter or limit the count. If you find no issues, return an empty findings array.

If test files appear in the diff alongside source files, briefly assess whether the test changes adequately cover the source changes. If source files are changed but related test files in the diff appear to have insufficient coverage for the changes, mention this as a suggestion. Only observe test coverage for files actually present in the diff -- do not speculate about test files not included in the diff.

${JSON_RESPONSE_INSTRUCTION}`;

  const effectiveMode = mode ?? 'balanced';
  return basePrompt + getModeOverlay(effectiveMode);
}

/**
 * Build convention scan instructions from changed files.
 * Extracts unique directories and instructs Claude to read nearby files
 * to understand codebase conventions before reviewing.
 */
function buildConventionScanInstructions(changedFiles: PRFile[]): string {
  const dirs = [...new Set(changedFiles.map(f => {
    const parts = f.filename.split('/');
    parts.pop();
    return parts.join('/') || '.';
  }))];
  const dirList = dirs.map(d => '- `' + d + '/`').join('\n');

  return `## Convention Scan

Before reviewing the diff, read 2-3 existing files in or near the directories containing the changed files to understand the codebase's conventions:

${dirList}

Identify structural patterns in these files:
- **Naming conventions**: How are functions, classes, constants, and files named?
- **Error handling patterns**: Does the codebase use custom error classes, error codes, or raw throws?
- **Import organization**: Are imports grouped (external first, then internal)? Are there barrel files?
- **Module structure**: How are exports organized? Are there consistent patterns for default vs named exports?

Do NOT look for style conventions (indentation, semicolons, quotes) -- those are the linter's job.

When you find a convention violation in the PR changes, your finding description MUST reference the established pattern with specific file:line evidence. For example: "This module uses throw new AppError(...) for error handling (see auth.ts:45, db.ts:32), but this function uses raw throw."`;
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
export function buildAgenticPrompt(prData: PRData, mode?: ReviewMode, context?: ReviewContext): string {
  const description = prData.body || '(no description provided)';
  const changedFileList = prData.files.map(f => `- ${f.filename} (${f.status}: +${f.additions} -${f.deletions})`).join('\n');
  const intentGuidance = context?.intent ? getIntentGuidance(context.intent) : '';

  // Build exploration section: structured per-file guidance if provided, otherwise generic
  const hasGuidance = context?.explorationGuidance && context.explorationGuidance.length > 0;
  let explorationSection: string;

  if (hasGuidance) {
    const perFileGuidance = context!.explorationGuidance!.map(g => {
      const categoryLines = g.categories.map(cat => {
        switch (cat) {
          case 'callers':
            return '- **Callers**: Find functions/modules that import or call into this file. Check if the changes break their expectations.';
          case 'tests':
            return '- **Tests**: Find and read test files for this module. Assess whether tests cover the changed behavior.';
          case 'type-definitions':
            return '- **Type definitions**: If this file exports types consumed elsewhere, check consumers for compatibility.';
          default:
            return `- **${cat}**: Explore this category for potential issues.`;
        }
      }).join('\n');
      return `### ${g.file}\n${categoryLines}`;
    }).join('\n\n');

    explorationSection = `## Codebase Exploration

After reviewing the diff, explore the codebase to find issues that are invisible from the diff alone. For each changed file, explore these categories:

${perFileGuidance}

Exploration is unlimited -- there are no artificial limits on how many files you read. Stop exploring when further investigation is unlikely to reveal new issues.

Every cross-file finding MUST reference specific files and lines as evidence -- verifiable claims only. Every cross-file finding MUST include relatedLocations connecting back to the PR changes that caused the issue.`;
  } else {
    explorationSection = `## Codebase Exploration

After reviewing the diff, explore the codebase to find issues that are invisible from the diff alone. You decide where to look and when to stop based on what the diff tells you.

Look for:
- **Broken callers**: Functions or APIs whose signature or behavior changed in the diff, but consumers elsewhere still expect the old contract
- **Pattern violations**: Changes that diverge from established codebase conventions (a pattern requires 2-3 instances in the codebase to be considered established)
- **Duplication**: The PR introduces code that already exists elsewhere in the codebase
- **Test coverage gaps**: Discover and read test files to assess whether the changed code has adequate test coverage

Exploration is unlimited -- there are no artificial limits on how many files you read. Read the diff first, then decide which exploration categories are most relevant. Stop exploring when further investigation is unlikely to reveal new issues.

Every cross-file finding MUST reference specific files and lines as evidence -- verifiable claims only. Every cross-file finding MUST include relatedLocations connecting back to the PR changes that caused the issue.`;
  }

  const basePrompt = `You are a senior software engineer performing a thorough code review of a pull request. You have full access to the codebase. Your role is to be a helpful, constructive colleague -- not a pedantic gatekeeper. Focus on issues that matter: bugs, security vulnerabilities, logic errors, and meaningful code quality improvements.

## Security Constraints

Your role is READ-ONLY analysis. Report findings, do not fix them.

- NEVER run \`git push\`, \`git remote add\`, or any command that sends data to a remote
- NEVER run \`gh pr close\`, \`gh pr merge\`, \`gh pr approve\`, \`gh pr review --approve\`
- NEVER run \`gh repo delete\`, \`gh repo edit\`
- NEVER run \`gh issue close\`, \`gh issue delete\`
- NEVER modify any files in the repository being reviewed
- NEVER run any command that creates, deletes, or modifies GitHub resources

Read the diff carefully, then explore the codebase to understand how these changes interact with existing code.

${buildConventionScanInstructions(prData.files)}

<pr_metadata>
Title: ${prData.title}
Description: ${description}
Branch: ${prData.headBranch} -> ${prData.baseBranch}
Changed files: ${prData.changedFiles} (+${prData.additions} -${prData.deletions})
</pr_metadata>
${intentGuidance}

<changed_files>
${changedFileList}
</changed_files>

<diff>
${truncateDiff(prData.diff)}
</diff>

## Review Instructions

Read the diff above thoroughly and identify all issues in the changed code before beginning any codebase exploration. Complete your diff analysis first — only then explore cross-file implications. Focus on the CHANGED code (lines with + prefix in the diff). Only flag issues in unchanged context lines if they are directly affected by the changes.

${FINDING_FORMAT_INSTRUCTIONS}

${SEVERITY_EXAMPLES}

Report all issues you find. Do not filter or limit the count. If you find no issues, return an empty findings array.

If a fix requires changes beyond the scope of this PR (e.g., a broader refactoring effort across multiple components), frame it as a follow-up recommendation rather than a targeted suggestion. Do not flag issues that cannot be meaningfully addressed within this PR alone.

${explorationSection}

## Output Format

Present findings in a SINGLE JSON array. Place diff-visible findings first in the array, followed by cross-file findings discovered through exploration. Both use the identical schema above.

${JSON_RESPONSE_INSTRUCTION}`;

  const effectiveMode = mode ?? 'balanced';
  return basePrompt + getModeOverlay(effectiveMode);
}

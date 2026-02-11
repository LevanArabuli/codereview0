import type { PRData } from './types.js';

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

/**
 * Build a complete review prompt from PR data for Claude CLI analysis.
 *
 * The prompt includes a reviewer persona, PR metadata in XML tags,
 * the raw unified diff, finding format instructions, and scope guidance.
 */
export function buildPrompt(prData: PRData): string {
  const description = prData.body || '(no description provided)';

  return `You are an experienced software engineer reviewing a pull request. Your role is to be a helpful, constructive colleague -- not a pedantic gatekeeper. Focus on issues that matter: bugs, security vulnerabilities, logic errors, and meaningful code quality improvements.

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

For each issue found, provide:
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
- relatedLocations: (optional) array of other locations in the diff related to this issue, each with file, line, and reason

Focus on the CHANGED code (lines with + prefix in the diff). Only flag issues in unchanged context lines if they are directly affected by the changes.

Report all issues you find. Do not filter or limit the count. If you find no issues, return an empty findings array.

If test files appear in the diff alongside source files, briefly assess whether the test changes adequately cover the source changes. If source files are changed but related test files in the diff appear to have insufficient coverage for the changes, mention this as a suggestion. Only observe test coverage for files actually present in the diff -- do not speculate about test files not included in the diff.

IMPORTANT: Respond with ONLY a valid JSON object matching this exact structure — no explanation, no markdown, no tool calls:
{"findings": [{"file": "string", "line": number, "severity": "bug"|"security"|"suggestion"|"nitpick", "confidence": "high"|"medium"|"low", "category": "string", "description": "string"}]}
Optional fields per finding: "endLine" (number), "suggestedFix" (string), "relatedLocations" ([{"file": "string", "line": number, "reason": "string"}])`;
}

/**
 * Build a deep exploration prompt that guides Claude's agentic codebase analysis.
 *
 * Unlike buildPrompt (diff-only), this prompt instructs Claude to use Read, Grep,
 * and Glob tools to explore the repository beyond the diff, finding cross-file
 * impacts, broken callers, missing updates, and pattern violations.
 */
export function buildDeepPrompt(prData: PRData): string {
  const description = prData.body || '(no description provided)';
  const changedFileList = prData.files.map(f => `- ${f.filename} (${f.status}: +${f.additions} -${f.deletions})`).join('\n');

  return `You are a senior software engineer performing a deep codebase analysis of a pull request. Your goal is to find cross-file impacts -- issues that are NOT visible from the diff alone but require understanding how the changes interact with the rest of the codebase.

<pr_metadata>
Title: ${prData.title}
Description: ${description}
Branch: ${prData.headBranch} -> ${prData.baseBranch}
Changed files: ${prData.changedFiles} (+${prData.additions} -${prData.deletions})
</pr_metadata>

<changed_files>
${changedFileList}
</changed_files>

<diff_summary>
The diff modifies ${prData.changedFiles} file(s) with ${prData.additions} additions and ${prData.deletions} deletions.
Review the diff below to understand what changed, then explore the codebase to find cross-file impacts.
</diff_summary>

<diff>
${truncateDiff(prData.diff)}
</diff>

## Your Exploration Strategy

Follow this approach to find cross-file issues:

1. **Read the changed files** to understand the modifications in full context.
2. **Use Grep to find callers and consumers** of any changed functions, classes, types, or exports. Search for function names, type names, and import paths that were modified.
3. **Use Glob to discover related files** in the same module, directory, or package. Look for files that follow similar naming patterns or belong to the same feature area.
4. **Read relevant snippets** from discovered files -- focus on the specific lines that reference the changed code, not entire files.
5. **Discover test files** for the changed code. First try naming conventions: use Glob to find \`*.test.*\`, \`*.spec.*\` files matching changed source file names, and \`__tests__/\`, \`test/\`, \`tests/\` directories near the changed files. If no test files found via naming, use Grep to search for imports of the changed modules across test directories. Read discovered test files to learn the project's test framework and existing test conventions.
6. **Observe codebase patterns** while exploring related files. Note how the rest of the codebase handles error handling, naming, architecture, API style, async patterns, logging, and code organization. Compare the changed code's approach against these patterns.

## Constraints

- Explore at most **25 files** beyond the changed files for cross-file impact analysis. Prioritize files that directly import from or are imported by the changed files.
- Explore up to an additional **10 test files** for test coverage assessment. Test files do NOT count against the 25-file code exploration cap.
- Read only relevant sections of discovered files, not entire files.
- Focus on files that import from or are imported by the changed files.
- Skip documentation and configuration files unless directly relevant to a cross-file impact.
- Do **NOT** report issues that are already visible in the diff alone (e.g., typos, simple logic errors, style issues that need no codebase context). Only report issues that require cross-file context to identify. Exception: test coverage gaps (item 5) and pattern alignment observations (item 6) are always in scope -- these inherently require codebase exploration to assess.

## What to Look For

1. **Broken callers** (severity: "bug"): Functions, methods, or APIs whose signature or behavior changed in the diff, but callers elsewhere in the codebase still expect the old signature or behavior.
2. **Missing updates** (severity: "bug"): Other files that need corresponding changes to remain consistent with the diff (e.g., shared constants, configuration, type definitions not updated).
3. **Pattern violations** (severity: "suggestion"): The changes break patterns or conventions established elsewhere in the codebase (e.g., error handling style, naming conventions, architectural layers).
4. **Interface mismatches** (severity: "bug"): Type or interface changes in the diff that are not propagated to all implementations, consumers, or dependents.
5. **Test coverage gaps** for changed code (severity varies):
   - Discover test files for the changed modules using the strategy in step 5 above.
   - Read discovered test files to identify the test framework (Jest, Vitest, pytest, Go testing, etc.) and existing test conventions.
   - Classify the coverage situation:
     - **No tests exist** for the changed module at all (severity: "suggestion", or "bug" if the changed code is critical logic like auth, payments, or data integrity): Report this and suggest what should be tested, referencing the project's actual test framework and conventions.
     - **Tests exist but don't cover the changed function/path** (severity: "suggestion"): Name the existing test file, note what it covers, and suggest what additional coverage is needed for the changed code.
     - **Tests exist but miss edge cases introduced by the changes** (severity: "nitpick"): Name the specific edge cases the changed code introduces.
   - When suggesting what to test, be specific for simple cases (e.g., "test that parseUrl returns null for empty string") and suggest categories for complex cases (e.g., "add integration tests for the new auth flow covering success, failure, and timeout scenarios").
   - Always reference the actual test framework used in the project (e.g., "Add a Vitest describe block in tests/analyzer.test.ts" not just "add tests").
6. **Pattern misalignment** with codebase conventions (severity: "suggestion" or "nitpick"):
   - While exploring the codebase for cross-file impacts, observe the patterns used in related files: error handling style, naming conventions, architectural layers, code organization, API style (function signatures, parameter patterns, return types), async patterns, logging patterns, and type patterns.
   - If the changed code deviates from an established codebase pattern, report as "suggestion" for meaningful deviations (different error handling strategy, different architectural approach) or "nitpick" for minor deviations (naming style, formatting preference).
   - A pattern requires at least 2-3 instances in the codebase to be considered "established." A single file doing something differently is just variation, not a violation.
   - If the codebase itself is inconsistent about a pattern (e.g., some files use pattern A, others use pattern B), report the inconsistency as a single "nitpick" finding rather than recommending either approach.
   - Include a brief code example from the codebase when it helps illustrate the established pattern. Skip examples when the pattern is obvious from the description.

## Output Requirements

- Every finding MUST include a \`relatedLocations\` array listing the changed file(s) from this PR that caused the cross-file impact. This connects each finding back to the PR changes.
- Use "bug" severity for broken callers, missing updates, and interface mismatches.
- Use "suggestion" severity for pattern violations.
- Use "high" confidence when you can see both the change and the broken consumer. Use "medium" when the impact is likely but not certain. Use "low" when the impact is speculative.
- If you find no cross-file issues, return an empty findings array. This is a valid and expected outcome for well-contained changes.

IMPORTANT: Respond with ONLY a valid JSON object matching this exact structure -- no explanation, no markdown, no tool calls:
{"findings": [{"file": "string", "line": number, "severity": "bug"|"security"|"suggestion"|"nitpick", "confidence": "high"|"medium"|"low", "category": "string", "description": "string"}]}
Optional fields per finding: "endLine" (number), "suggestedFix" (string), "relatedLocations" ([{"file": "string", "line": number, "reason": "string"}])`;
}

import type { PRData } from './types.js';

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
${prData.diff}
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
${prData.diff}
</diff>

## Your Exploration Strategy

Follow this approach to find cross-file issues:

1. **Read the changed files** to understand the modifications in full context.
2. **Use Grep to find callers and consumers** of any changed functions, classes, types, or exports. Search for function names, type names, and import paths that were modified.
3. **Use Glob to discover related files** in the same module, directory, or package. Look for files that follow similar naming patterns or belong to the same feature area.
4. **Read relevant snippets** from discovered files -- focus on the specific lines that reference the changed code, not entire files.

## Constraints

- Explore at most **25 files** beyond the changed files. Prioritize files that directly import from or are imported by the changed files.
- Read only relevant sections of discovered files, not entire files.
- Focus on files that import from or are imported by the changed files.
- Skip test files, documentation, and configuration files unless they are directly relevant to a cross-file impact.
- Do **NOT** report issues that are already visible in the diff alone. Only report issues that require cross-file context to identify.

## What to Look For

1. **Broken callers** (severity: "bug"): Functions, methods, or APIs whose signature or behavior changed in the diff, but callers elsewhere in the codebase still expect the old signature or behavior.
2. **Missing updates** (severity: "bug"): Other files that need corresponding changes to remain consistent with the diff (e.g., shared constants, configuration, type definitions not updated).
3. **Pattern violations** (severity: "suggestion"): The changes break patterns or conventions established elsewhere in the codebase (e.g., error handling style, naming conventions, architectural layers).
4. **Interface mismatches** (severity: "bug"): Type or interface changes in the diff that are not propagated to all implementations, consumers, or dependents.

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

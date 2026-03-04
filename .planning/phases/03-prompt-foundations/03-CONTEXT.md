# Phase 3: Prompt Foundations - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Prompt templates anchor the model's severity labels and suppress low-value findings through concrete examples. Balanced mode gets anti-examples of what NOT to flag. All modes get few-shot severity anchoring examples. Covers PROMPT-01 and PROMPT-03. No new CLI flags, no mode changes, no structural prompt changes.

</domain>

<decisions>
## Implementation Decisions

### Anti-example content
- Add 3-4 concrete code snippet anti-examples to balanced mode overlay
- Primary focus on TypeScript noise (issues TS compiler already catches: unused vars, missing return types, implicit any)
- Include 1-2 snippets from style/defensive categories as secondary examples
- Anti-examples use "This is NOT a finding" framing with code snippets showing the pattern to skip
- Anti-examples apply to balanced mode ONLY -- other modes have their own philosophy (detailed wants everything, strict ignores nitpicks anyway)
- Expand the existing "Do NOT report" bullet list in MODE_OVERLAYS.balanced with the concrete snippets directly after the current text bullets

### Severity anchoring examples
- Code snippet + expected finding JSON format -- teaches by example with observable characteristics
- 1 example per severity level: bug, security, suggestion, nitpick (4 total)
- Language-agnostic examples (generic patterns like null deref, SQL injection, unused import) -- tool reviews any language
- Examples stored as a new shared constant (like FINDING_FORMAT_INSTRUCTIONS) to prevent drift between buildPrompt and buildAgenticPrompt

### Prompt placement
- Severity examples in a new SEVERITY_EXAMPLES shared constant alongside FINDING_FORMAT_INSTRUCTIONS
- Anti-examples expand the existing balanced mode "Do NOT report" list inline in MODE_OVERLAYS.balanced
- Both buildPrompt() and buildAgenticPrompt() reference the shared severity constant -- no duplication

### Claude's Discretion
- Exact code snippets for anti-examples and severity anchoring examples
- Exact JSON structure shown in few-shot examples
- Where in the prompt the SEVERITY_EXAMPLES constant is inserted (before or after FINDING_FORMAT_INSTRUCTIONS)
- Whether anti-example snippets use diff format or plain code

</decisions>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `FINDING_FORMAT_INSTRUCTIONS` (prompt.ts): Shared constant pattern -- severity examples should follow this exact pattern
- `JSON_RESPONSE_INSTRUCTION` (prompt.ts): Another shared constant -- establishes the extraction pattern
- `MODE_OVERLAYS` (prompt.ts): Record<ReviewMode, string> -- balanced mode overlay is the target for anti-examples
- `eval.test.ts` + `tests/fixtures/`: Eval infrastructure for regression testing after prompt changes

### Established Patterns
- Shared constants extracted to module level prevent drift between quick and deep mode prompts
- Mode overlays appended at the end of both prompt functions identically
- Prompt text uses markdown headers and bullet lists for structure

### Integration Points
- `MODE_OVERLAYS.balanced` in prompt.ts -- expand with anti-examples
- Both `buildPrompt()` and `buildAgenticPrompt()` -- insert SEVERITY_EXAMPLES reference
- `eval.test.ts` -- run after changes to verify no regression

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 03-prompt-foundations*
*Context gathered: 2026-03-04*

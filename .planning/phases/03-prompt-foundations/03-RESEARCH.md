# Phase 03: Prompt Foundations - Research

**Researched:** 2026-03-04
**Domain:** LLM prompt engineering for code review severity calibration and noise suppression
**Confidence:** HIGH

## Summary

This phase modifies `src/prompt.ts` to add two categories of prompt content: (1) concrete anti-examples in the balanced mode overlay showing what NOT to flag, and (2) few-shot severity anchoring examples as a new shared constant used by both `buildPrompt()` and `buildAgenticPrompt()`. The codebase already has the exact patterns needed -- shared constants (`FINDING_FORMAT_INSTRUCTIONS`, `JSON_RESPONSE_INSTRUCTION`) and mode overlays (`MODE_OVERLAYS`) -- so this is purely a content authoring task within established code structure.

No new dependencies, no new files, no structural changes. The risk is entirely in prompt quality: poorly chosen examples could degrade review output. The eval test suite (`eval.test.ts` with 3 PR fixtures) and the prompt test suite (`prompt.test.ts` with 40+ tests) provide regression detection.

**Primary recommendation:** Author prompt content inline in `prompt.ts` following the existing shared-constant pattern, then validate with `npm test` to catch structural regressions and `npm run lint` for type-checking.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Add 3-4 concrete code snippet anti-examples to balanced mode overlay
- Primary focus on TypeScript noise (issues TS compiler already catches: unused vars, missing return types, implicit any)
- Include 1-2 snippets from style/defensive categories as secondary examples
- Anti-examples use "This is NOT a finding" framing with code snippets showing the pattern to skip
- Anti-examples apply to balanced mode ONLY -- other modes have their own philosophy
- Expand the existing "Do NOT report" bullet list in MODE_OVERLAYS.balanced with the concrete snippets directly after the current text bullets
- Code snippet + expected finding JSON format for severity anchoring -- teaches by example with observable characteristics
- 1 example per severity level: bug, security, suggestion, nitpick (4 total)
- Language-agnostic examples (generic patterns like null deref, SQL injection, unused import)
- Examples stored as a new shared constant (like FINDING_FORMAT_INSTRUCTIONS) to prevent drift
- Severity examples in a new SEVERITY_EXAMPLES shared constant alongside FINDING_FORMAT_INSTRUCTIONS
- Anti-examples expand the existing balanced mode "Do NOT report" list inline in MODE_OVERLAYS.balanced
- Both buildPrompt() and buildAgenticPrompt() reference the shared severity constant -- no duplication

### Claude's Discretion
- Exact code snippets for anti-examples and severity anchoring examples
- Exact JSON structure shown in few-shot examples
- Where in the prompt the SEVERITY_EXAMPLES constant is inserted (before or after FINDING_FORMAT_INSTRUCTIONS)
- Whether anti-example snippets use diff format or plain code

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROMPT-01 | Balanced mode overlay includes concrete anti-examples of what NOT to flag (trailing newlines, missing JSDoc on private methods, issues TypeScript already catches) | Anti-examples expand MODE_OVERLAYS.balanced inline; existing test assertions for balanced overlay content in prompt.test.ts provide regression coverage |
| PROMPT-03 | Prompt includes few-shot examples of each severity level (bug, security, suggestion, nitpick) anchoring the model's labels to observable characteristics | New SEVERITY_EXAMPLES shared constant follows FINDING_FORMAT_INSTRUCTIONS pattern; inserted into both buildPrompt() and buildAgenticPrompt() |
</phase_requirements>

## Standard Stack

No new libraries needed. This phase is pure prompt content authoring within existing code.

### Core (Existing, Unchanged)
| Library | Version | Purpose | Role in This Phase |
|---------|---------|---------|-------------------|
| typescript | strict mode | Type checking | `npm run lint` validates prompt.ts after edits |
| vitest | existing | Test runner | `npm test` runs prompt.test.ts and eval.test.ts |

### Installation
```bash
# No new packages needed
```

## Architecture Patterns

### Existing Code Structure (Do Not Change)
```
src/
├── prompt.ts          # ALL changes go here
│   ├── FINDING_FORMAT_INSTRUCTIONS  (shared const -- pattern to follow)
│   ├── JSON_RESPONSE_INSTRUCTION    (shared const -- pattern to follow)
│   ├── MODE_OVERLAYS                (Record<ReviewMode, string> -- balanced entry expanded)
│   ├── buildPrompt()                (insert SEVERITY_EXAMPLES reference)
│   └── buildAgenticPrompt()         (insert SEVERITY_EXAMPLES reference)
tests/
├── prompt.test.ts     # Add new assertions for anti-examples and severity examples
└── eval.test.ts       # Run unchanged to detect regression
```

### Pattern 1: Shared Constant for Prompt Sections
**What:** Module-level `const` string containing prompt text, referenced by both `buildPrompt()` and `buildAgenticPrompt()`.
**When to use:** Any prompt content that must be identical across quick and deep modes.
**Example (existing pattern):**
```typescript
// Source: src/prompt.ts lines 51-64
const FINDING_FORMAT_INSTRUCTIONS = `For each issue found, provide:
- file: the file path exactly as shown in the diff
...`;
```
The new `SEVERITY_EXAMPLES` constant follows this exact pattern -- a module-level `const` string.

### Pattern 2: Mode Overlay Inline Expansion
**What:** `MODE_OVERLAYS.balanced` is a template literal string. Anti-examples are appended after the existing "Do NOT report" bullet list.
**When to use:** Mode-specific prompt content that should not leak to other modes.
**Example (existing pattern):**
```typescript
// Source: src/prompt.ts lines 35-44
balanced: `\n\nREVIEW MODE — BALANCED: ...
Do NOT report:
- File formatting issues (trailing newlines, whitespace, indentation)
- Idiomatic language/framework patterns...
- Theoretical concerns without evidence...

Before including a suggestion, ask: "Would a senior engineer..."`
```
Anti-examples are inserted between the bullet list and the "Before including a suggestion" paragraph.

### Pattern 3: Prompt Insertion Points
**What:** Both `buildPrompt()` and `buildAgenticPrompt()` compose their output by string concatenation of constants and dynamic sections.
**Recommended insertion for SEVERITY_EXAMPLES:** After `FINDING_FORMAT_INSTRUCTIONS` and before `JSON_RESPONSE_INSTRUCTION`. This places the examples right after the field definitions, so the model sees "here are the fields" then "here are examples of correctly labeled findings" then "respond in JSON."

In `buildPrompt()` (line 122-130):
```typescript
${FINDING_FORMAT_INSTRUCTIONS}

${SEVERITY_EXAMPLES}        // <-- NEW insertion point

Focus on the CHANGED code...
```

In `buildAgenticPrompt()` (line 230-242):
```typescript
${FINDING_FORMAT_INSTRUCTIONS}

${SEVERITY_EXAMPLES}        // <-- NEW insertion point

Report all issues you find...
```

### Anti-Patterns to Avoid
- **Duplicating prompt text across functions:** Always use shared constants. The codebase already enforces this -- never inline severity examples separately in each function.
- **Modifying other mode overlays:** Anti-examples are balanced-mode-only per user decision. Do not touch strict/detailed/lenient overlays.
- **Long examples that bloat context:** Keep each few-shot example to 3-5 lines of code + minimal JSON. The prompt competes with diff content for context window space.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Severity definitions | New severity enum or schema | Existing `FINDING_FORMAT_INSTRUCTIONS` field definitions | Already defines severity levels with descriptions |
| Anti-example templating | Dynamic template system | Static string in MODE_OVERLAYS.balanced | Mode overlays are static strings -- keep it simple |
| Example validation | Runtime validation of examples | Tests asserting content presence | Static prompt content validated by test assertions |

## Common Pitfalls

### Pitfall 1: Anti-Examples That Are Too Specific
**What goes wrong:** Anti-examples reference language-specific patterns (e.g., React hooks rules) that don't apply to all codebases being reviewed.
**Why it happens:** Tool reviews any language -- TypeScript, Python, Go, etc.
**How to avoid:** Anti-examples for balanced mode should focus on universal noise: TS compiler-catchable issues (unused vars, missing return types) and universal style noise (trailing newlines, JSDoc on private methods). The user decision already specifies this.
**Warning signs:** Anti-examples mention framework-specific APIs.

### Pitfall 2: Few-Shot Examples That Conflict With Field Definitions
**What goes wrong:** The example JSON uses different field names or severity labels than `FINDING_FORMAT_INSTRUCTIONS` defines.
**Why it happens:** Copy-paste drift between the field spec and examples.
**How to avoid:** Use the exact schema from `ReviewFindingSchema` (schemas.ts) -- fields are: file, line, severity, confidence, category, description. Optional: endLine, suggestedFix, relatedLocations.
**Warning signs:** Examples include fields not in the schema, or use severity values outside the enum.

### Pitfall 3: Breaking Existing Test Assertions
**What goes wrong:** Expanding MODE_OVERLAYS.balanced changes its content, potentially breaking string-matching tests in prompt.test.ts.
**Why it happens:** Tests like `expect(overlay).toMatch(/do not report/i)` (line 76) or `expect(overlay).toMatch(/trailing newline/i)` (line 81) match existing content that must remain present.
**How to avoid:** Only ADD content to the balanced overlay -- never remove or rephrase existing text. Run `npx vitest run tests/prompt.test.ts` after every edit.
**Warning signs:** Test failures in "balanced overlay suppresses formatting issues" or "balanced overlay suppresses idiomatic patterns" test groups.

### Pitfall 4: Severity Examples Too Long
**What goes wrong:** Each example uses 10+ lines of code, expanding prompt by 500+ tokens and reducing space for actual diff content.
**Why it happens:** Wanting to show "realistic" code.
**How to avoid:** Keep each example to 2-4 lines of code + 1 compact JSON object showing the expected finding. The purpose is label anchoring, not comprehensive demonstration. Total SEVERITY_EXAMPLES should be under ~60 lines.
**Warning signs:** The constant exceeds 80 lines or 2000 characters.

### Pitfall 5: Anti-Example Snippets in Diff Format Causing Confusion
**What goes wrong:** If anti-examples use diff format (`+`/`-` prefixes), the model might confuse them with the actual PR diff.
**How to avoid:** Use plain code format for anti-examples (no diff markers). This is a discretion item -- plain code is recommended.

## Code Examples

### Anti-Example Content Structure (for MODE_OVERLAYS.balanced)
```typescript
// Appended after existing "Do NOT report:" bullets, before "Before including a suggestion..."

// Example anti-examples (exact content is Claude's discretion):
`
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
`
```

### Severity Anchoring Example Structure (for SEVERITY_EXAMPLES constant)
```typescript
// New shared constant following FINDING_FORMAT_INSTRUCTIONS pattern
const SEVERITY_EXAMPLES = `Here are examples of correctly labeled findings at each severity level:

**bug** -- Observable incorrect behavior:
\`\`\`
const users = await db.query("SELECT * FROM users");
return users[0].name; // crashes with TypeError if query returns empty array
\`\`\`
{"file": "src/users.ts", "line": 2, "severity": "bug", "confidence": "high", "category": "null-safety", "description": "Array access without bounds check. db.query may return an empty array, causing TypeError on .name access. Add a length check or use optional chaining."}

**security** -- Exploitable vulnerability:
\`\`\`
const query = "SELECT * FROM users WHERE id = " + userId;
\`\`\`
{"file": "src/db.ts", "line": 1, "severity": "security", "confidence": "high", "category": "sql-injection", "description": "String concatenation in SQL query allows injection. Use parameterized queries instead."}

**suggestion** -- Meaningful improvement:
\`\`\`
let result = [];
for (const item of items) {
  if (item.active) result.push(item.name);
}
\`\`\`
{"file": "src/filter.ts", "line": 1, "severity": "suggestion", "confidence": "medium", "category": "readability", "description": "Imperative filter+map loop can be replaced with items.filter(i => i.active).map(i => i.name) for clarity."}

**nitpick** -- Minor style observation:
\`\`\`
import { readFile } from 'fs/promises';
import { join } from 'path'; // unused in this file
\`\`\`
{"file": "src/loader.ts", "line": 2, "severity": "nitpick", "confidence": "high", "category": "unused-import", "description": "The 'join' import from 'path' appears unused. Remove it to keep imports clean."}`;
```

### Test Assertions to Add (prompt.test.ts)
```typescript
// For PROMPT-01: anti-examples in balanced mode
it('balanced overlay contains concrete anti-example snippets', () => {
  const overlay = getModeOverlay('balanced');
  expect(overlay).toContain('This is NOT a finding');
});

it('balanced overlay anti-examples mention TypeScript compiler', () => {
  const overlay = getModeOverlay('balanced');
  expect(overlay).toMatch(/typescript|TS error|ts\d{4}/i);
});

// For PROMPT-03: severity examples in both prompts
it('buildPrompt includes severity anchoring examples', () => {
  const prompt = buildPrompt(mockPR);
  expect(prompt).toContain('bug');
  expect(prompt).toContain('security');
  expect(prompt).toContain('suggestion');
  expect(prompt).toContain('nitpick');
  // Check for actual example structure
  expect(prompt).toMatch(/"severity":\s*"bug"/);
});

it('buildAgenticPrompt includes severity anchoring examples', () => {
  const prompt = buildAgenticPrompt(mockPR);
  expect(prompt).toMatch(/"severity":\s*"bug"/);
  expect(prompt).toMatch(/"severity":\s*"security"/);
});

it('severity examples identical in quick and agentic prompts', () => {
  const quick = buildPrompt(mockPR);
  const agentic = buildAgenticPrompt(mockPR);
  // Both should contain the same SEVERITY_EXAMPLES text
  expect(quick).toContain('correctly labeled findings');
  expect(agentic).toContain('correctly labeled findings');
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Severity labels defined only in field spec | Few-shot examples anchoring each label | Current best practice for LLM calibration | Reduces label confusion (model sees concrete examples, not just definitions) |
| "Don't report X" as abstract rules | Concrete anti-examples with code snippets | Emerging prompt engineering pattern | Abstract rules get ignored; code examples are much harder to misinterpret |

## Open Questions

1. **SEVERITY_EXAMPLES placement relative to FINDING_FORMAT_INSTRUCTIONS**
   - What we know: Both positions (before/after) work. After is more natural (define fields, then show examples).
   - Recommendation: Place SEVERITY_EXAMPLES after FINDING_FORMAT_INSTRUCTIONS. This is a discretion item.

2. **Anti-example snippet format**
   - What we know: Plain code avoids confusion with actual diff. Diff format is slightly more realistic.
   - Recommendation: Use plain code (no diff markers). The anti-examples demonstrate what patterns to skip, not what diff hunks look like.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | vitest via package.json |
| Quick run command | `npx vitest run tests/prompt.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROMPT-01 | Balanced mode overlay contains concrete anti-examples with "This is NOT a finding" framing and TS noise examples | unit | `npx vitest run tests/prompt.test.ts -t "anti-example"` | Needs new assertions |
| PROMPT-01 | Anti-examples only in balanced mode, not in other modes | unit | `npx vitest run tests/prompt.test.ts -t "anti-example"` | Needs new assertions |
| PROMPT-03 | Both buildPrompt and buildAgenticPrompt contain severity anchoring examples | unit | `npx vitest run tests/prompt.test.ts -t "severity"` | Needs new assertions |
| PROMPT-03 | Severity examples are identical across quick and agentic modes (shared constant) | unit | `npx vitest run tests/prompt.test.ts -t "identical"` | Needs new assertions |
| PROMPT-01 + PROMPT-03 | Eval suite shows no regression after prompt changes | integration | `npx vitest run tests/eval.test.ts` | Exists (eval.test.ts) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/prompt.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test assertions in `tests/prompt.test.ts` for anti-example content (PROMPT-01)
- [ ] New test assertions in `tests/prompt.test.ts` for severity examples presence and identity across modes (PROMPT-03)

## Sources

### Primary (HIGH confidence)
- `src/prompt.ts` -- direct code inspection of existing shared constants, MODE_OVERLAYS structure, buildPrompt/buildAgenticPrompt insertion points
- `tests/prompt.test.ts` -- 40+ existing test assertions that must continue to pass
- `tests/eval.test.ts` -- eval infrastructure with 3 PR fixtures for regression detection
- `src/schemas.ts` -- ReviewFindingSchema defining exact field names and severity enum values

### Secondary (MEDIUM confidence)
- CONTEXT.md user decisions -- locked implementation choices for anti-example framing, severity example format, and constant naming

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, pure content authoring in existing code
- Architecture: HIGH -- follows established shared-constant and mode-overlay patterns already in prompt.ts
- Pitfalls: HIGH -- identified from direct code inspection (test assertions, schema fields, context window budget)

**Research date:** 2026-03-04
**Valid until:** indefinite (prompt engineering patterns, not library versions)

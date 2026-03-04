import { describe, it, expect } from 'vitest';
import { getModeOverlay, buildPrompt, buildAgenticPrompt, REVIEW_MODES } from '../src/prompt.js';
import type { ReviewMode } from '../src/prompt.js';
import type { PRData, ReviewContext } from '../src/types.js';

const mockPR: PRData = {
  number: 1,
  title: 'Test PR',
  body: 'Test body',
  author: 'testuser',
  baseBranch: 'main',
  headBranch: 'feature',
  headSha: 'abc123',
  headRepoOwner: 'owner',
  headRepoName: 'repo',
  additions: 10,
  deletions: 5,
  changedFiles: 1,
  files: [{ filename: 'test.ts', status: 'modified', additions: 10, deletions: 5, changes: 15 }],
  diff: '--- a/test.ts\n+++ b/test.ts\n@@ -1,3 +1,5 @@\n+new line',
};

describe('REVIEW_MODES', () => {
  it('contains exactly four modes', () => {
    expect(REVIEW_MODES).toHaveLength(4);
  });

  it('includes strict, detailed, lenient, and balanced', () => {
    expect(REVIEW_MODES).toContain('strict');
    expect(REVIEW_MODES).toContain('detailed');
    expect(REVIEW_MODES).toContain('lenient');
    expect(REVIEW_MODES).toContain('balanced');
  });
});

describe('getModeOverlay', () => {
  it('returns non-empty string for each mode', () => {
    for (const mode of REVIEW_MODES) {
      const overlay = getModeOverlay(mode);
      expect(overlay.length).toBeGreaterThan(0);
    }
  });

  it('each overlay contains the mode name', () => {
    for (const mode of REVIEW_MODES) {
      const overlay = getModeOverlay(mode);
      expect(overlay.toUpperCase()).toContain(mode.toUpperCase());
    }
  });

  it('strict overlay mentions bugs and security', () => {
    const overlay = getModeOverlay('strict');
    expect(overlay).toContain('bug');
    expect(overlay).toContain('security');
  });

  it('strict overlay excludes nitpicks', () => {
    const overlay = getModeOverlay('strict');
    expect(overlay).toMatch(/not report.*nitpick|do not.*nitpick/i);
  });

  it('detailed overlay enables nitpicks', () => {
    const overlay = getModeOverlay('detailed');
    expect(overlay).toContain('nitpick');
    // Detailed should encourage, not suppress nitpicks
    expect(overlay).not.toMatch(/do not.*report.*nitpick/i);
  });

  it('lenient overlay skips nitpicks', () => {
    const overlay = getModeOverlay('lenient');
    expect(overlay).toMatch(/not report nitpicks|do not.*nitpick/i);
  });

  it('balanced overlay skips nitpicks', () => {
    const overlay = getModeOverlay('balanced');
    expect(overlay).toMatch(/do not report/i);
  });

  it('balanced overlay suppresses formatting issues', () => {
    const overlay = getModeOverlay('balanced');
    expect(overlay).toMatch(/trailing newline/i);
    expect(overlay).toMatch(/whitespace/i);
    expect(overlay).toMatch(/indentation/i);
  });

  it('balanced overlay suppresses idiomatic patterns', () => {
    const overlay = getModeOverlay('balanced');
    expect(overlay).toMatch(/prop spreading/i);
    expect(overlay).toMatch(/defensive ARIA/i);
    expect(overlay).toMatch(/concrete bug/i);
  });

  it('balanced overlay has senior engineer quality gate', () => {
    const overlay = getModeOverlay('balanced');
    expect(overlay).toMatch(/senior engineer/i);
  });

  it('returns different overlays for different modes', () => {
    const overlays = REVIEW_MODES.map(m => getModeOverlay(m));
    const unique = new Set(overlays);
    expect(unique.size).toBe(REVIEW_MODES.length);
  });
});

describe('buildPrompt with mode', () => {
  it('includes mode overlay in output', () => {
    const prompt = buildPrompt(mockPR, 'strict');
    const overlay = getModeOverlay('strict');
    expect(prompt).toContain(overlay);
  });

  it('defaults to balanced overlay when mode is undefined', () => {
    const prompt = buildPrompt(mockPR);
    const balancedOverlay = getModeOverlay('balanced');
    expect(prompt).toContain(balancedOverlay);
  });

  it('includes base prompt content regardless of mode', () => {
    for (const mode of REVIEW_MODES) {
      const prompt = buildPrompt(mockPR, mode);
      expect(prompt).toContain('Test PR');
      expect(prompt).toContain('Test body');
      expect(prompt).toContain('findings');
    }
  });

  it('appends overlay after base prompt JSON instruction', () => {
    const prompt = buildPrompt(mockPR, 'strict');
    const jsonInstructionIndex = prompt.indexOf('IMPORTANT: Respond with ONLY a valid JSON');
    const overlayIndex = prompt.indexOf('REVIEW MODE');
    expect(jsonInstructionIndex).toBeGreaterThan(-1);
    expect(overlayIndex).toBeGreaterThan(jsonInstructionIndex);
  });

  it('same mode produces same overlay for quick and agentic prompts', () => {
    const quickPrompt = buildPrompt(mockPR, 'strict');
    const agenticPrompt = buildAgenticPrompt(mockPR, 'strict');
    const overlay = getModeOverlay('strict');
    expect(quickPrompt).toContain(overlay);
    expect(agenticPrompt).toContain(overlay);
  });
});

describe('buildAgenticPrompt', () => {
  it('contains PR metadata', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toContain('Test PR');
    expect(prompt).toContain('Test body');
    expect(prompt).toContain('feature');
    expect(prompt).toContain('main');
  });

  it('contains diff content', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toContain(mockPR.diff);
  });

  it('contains exploration instructions for all four categories', () => {
    const prompt = buildAgenticPrompt(mockPR).toLowerCase();
    expect(prompt).toMatch(/broken callers|callers/);
    expect(prompt).toMatch(/pattern violations|conventions/);
    expect(prompt).toContain('duplication');
    expect(prompt).toMatch(/test coverage|test/);
  });

  it('contains separated sections instruction', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toMatch(/diff.*findings.*first/i);
    expect(prompt).toMatch(/cross-file.*findings/i);
  });

  it('contains JSON output instruction', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toContain('IMPORTANT: Respond with ONLY a valid JSON');
  });

  it('mode overlay included for strict', () => {
    const prompt = buildAgenticPrompt(mockPR, 'strict');
    const overlay = getModeOverlay('strict');
    expect(prompt).toContain(overlay);
  });

  it('defaults to balanced mode', () => {
    const prompt = buildAgenticPrompt(mockPR);
    const balancedOverlay = getModeOverlay('balanced');
    expect(prompt).toContain(balancedOverlay);
  });

  it('same overlay for all prompt types', () => {
    for (const mode of REVIEW_MODES) {
      const quickPrompt = buildPrompt(mockPR, mode);
      const agenticPrompt = buildAgenticPrompt(mockPR, mode);
      const overlay = getModeOverlay(mode);
      expect(quickPrompt).toContain(overlay);
      expect(agenticPrompt).toContain(overlay);
    }
  });

  it('no file budget or cap in prompt', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).not.toMatch(/at most/i);
    expect(prompt).not.toMatch(/file budget/i);
    expect(prompt).not.toMatch(/file cap/i);
    expect(prompt).not.toMatch(/explore at most/i);
  });

  it('contains evidence requirement', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toMatch(/evidence|specific files|relatedLocations/);
  });

  it('contains changed files list', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toContain('test.ts');
  });

  it('uses sectioned headers', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toContain('## Review Instructions');
    expect(prompt).toContain('## Codebase Exploration');
    expect(prompt).toContain('## Output Format');
  });

  it('buildPrompt still works with extracted constants', () => {
    const prompt = buildPrompt(mockPR);
    expect(prompt).toContain('IMPORTANT: Respond with ONLY a valid JSON');
    expect(prompt).toContain('bug: logic errors, crashes');
    expect(prompt).toContain('security: injection vulnerabilities');
    expect(prompt).toContain('suggestion: meaningful improvements');
    expect(prompt).toContain('nitpick: minor style preferences');
  });

  it('has diff-first analysis instruction', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toMatch(/Complete your diff analysis first/);
    expect(prompt).toMatch(/before beginning any codebase exploration/);
  });

  it('has cross-scope framing instruction', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toMatch(/beyond the scope of this PR/);
    expect(prompt).toMatch(/follow-up recommendation/);
  });

  it('exploration section unchanged (no file limits)', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toContain('Exploration is unlimited');
    expect(prompt).not.toMatch(/at most/i);
    expect(prompt).not.toMatch(/file budget/i);
  });
});

describe('buildPrompt with ReviewContext', () => {
  const mockContext: ReviewContext = {
    relatedFiles: [
      { path: 'src/utils.ts', content: 'export function helper() {}', reason: 'import' },
      { path: 'tests/test.test.ts', content: 'describe("test", () => {})', reason: 'test' },
    ],
  };

  it('includes related_file XML tags when relatedFiles provided', () => {
    const prompt = buildPrompt(mockPR, 'balanced', mockContext);
    expect(prompt).toContain('<related_file');
    expect(prompt).toContain('path="src/utils.ts"');
    expect(prompt).toContain('reason="import"');
    expect(prompt).toContain('export function helper() {}');
    expect(prompt).toContain('</related_file>');
  });

  it('includes related_file for each file with correct attributes', () => {
    const prompt = buildPrompt(mockPR, 'balanced', mockContext);
    expect(prompt).toContain('path="src/utils.ts"');
    expect(prompt).toContain('reason="import"');
    expect(prompt).toContain('path="tests/test.test.ts"');
    expect(prompt).toContain('reason="test"');
  });

  it('includes introductory text about related files', () => {
    const prompt = buildPrompt(mockPR, 'balanced', mockContext);
    expect(prompt).toContain('The following related files from the codebase provide additional context');
  });

  it('produces no related file section with empty relatedFiles array', () => {
    const emptyContext: ReviewContext = { relatedFiles: [] };
    const prompt = buildPrompt(mockPR, 'balanced', emptyContext);
    expect(prompt).not.toContain('<related_file');
    expect(prompt).not.toContain('related files from the codebase');
  });

  it('works identically to current behavior when context is undefined', () => {
    const withoutContext = buildPrompt(mockPR, 'balanced');
    const withUndefined = buildPrompt(mockPR, 'balanced', undefined);
    expect(withoutContext).toBe(withUndefined);
    expect(withoutContext).not.toContain('<related_file');
  });

  it('places related files after </diff> and before finding format instructions', () => {
    const prompt = buildPrompt(mockPR, 'balanced', mockContext);
    const diffEndIndex = prompt.indexOf('</diff>');
    const relatedFileIndex = prompt.indexOf('<related_file');
    const findingFormatIndex = prompt.indexOf('For each issue found');
    expect(diffEndIndex).toBeGreaterThan(-1);
    expect(relatedFileIndex).toBeGreaterThan(diffEndIndex);
    expect(findingFormatIndex).toBeGreaterThan(relatedFileIndex);
  });
});

describe('buildAgenticPrompt with ReviewContext', () => {
  const multiFilePR: PRData = {
    ...mockPR,
    files: [
      { filename: 'src/auth.ts', status: 'modified', additions: 20, deletions: 5, changes: 25 },
      { filename: 'src/middleware.ts', status: 'added', additions: 50, deletions: 0, changes: 50 },
    ],
    changedFiles: 2,
  };

  const mockGuidance: ReviewContext = {
    explorationGuidance: [
      { file: 'src/auth.ts', categories: ['callers', 'tests', 'type-definitions'] },
      { file: 'src/middleware.ts', categories: ['callers', 'tests', 'type-definitions'] },
    ],
  };

  it('replaces generic exploration with structured per-file guidance', () => {
    const prompt = buildAgenticPrompt(multiFilePR, 'balanced', mockGuidance);
    // Should contain per-file headers
    expect(prompt).toContain('### src/auth.ts');
    expect(prompt).toContain('### src/middleware.ts');
  });

  it('mentions callers, tests, type-definitions for each file', () => {
    const prompt = buildAgenticPrompt(multiFilePR, 'balanced', mockGuidance);
    expect(prompt).toMatch(/Callers/);
    expect(prompt).toMatch(/Tests/);
    expect(prompt).toMatch(/Type definitions/i);
  });

  it('removes generic exploration categories when guidance provided', () => {
    const prompt = buildAgenticPrompt(multiFilePR, 'balanced', mockGuidance);
    // Should NOT contain the generic exploration categories
    expect(prompt).not.toContain('**Broken callers**');
    expect(prompt).not.toContain('**Pattern violations**');
    expect(prompt).not.toContain('**Duplication**');
  });

  it('preserves evidence requirement and cross-file constraints', () => {
    const prompt = buildAgenticPrompt(multiFilePR, 'balanced', mockGuidance);
    expect(prompt).toContain('Every cross-file finding MUST reference specific files and lines as evidence');
    expect(prompt).toContain('Every cross-file finding MUST include relatedLocations');
  });

  it('works identically to current behavior when context is undefined', () => {
    const withoutContext = buildAgenticPrompt(mockPR);
    const withUndefined = buildAgenticPrompt(mockPR, 'balanced', undefined);
    expect(withoutContext).toBe(withUndefined);
    // Generic exploration should be present
    expect(withoutContext).toContain('**Broken callers**');
    expect(withoutContext).toContain('**Pattern violations**');
  });

  it('preserves generic exploration when explorationGuidance is empty array', () => {
    const emptyGuidance: ReviewContext = { explorationGuidance: [] };
    const prompt = buildAgenticPrompt(mockPR, 'balanced', emptyGuidance);
    expect(prompt).toContain('**Broken callers**');
    expect(prompt).toContain('**Pattern violations**');
  });

  it('still contains Codebase Exploration header', () => {
    const prompt = buildAgenticPrompt(multiFilePR, 'balanced', mockGuidance);
    expect(prompt).toContain('## Codebase Exploration');
  });

  it('contains unlimited exploration note with guidance', () => {
    const prompt = buildAgenticPrompt(multiFilePR, 'balanced', mockGuidance);
    expect(prompt).toContain('Exploration is unlimited');
  });
});

describe('anti-examples in balanced mode', () => {
  it('balanced overlay contains concrete anti-example snippets', () => {
    const overlay = getModeOverlay('balanced');
    expect(overlay).toContain('This is NOT a finding');
  });

  it('balanced overlay anti-examples mention TypeScript compiler', () => {
    const overlay = getModeOverlay('balanced');
    expect(overlay).toMatch(/typescript|TS error|ts\d{4}/i);
  });

  it('anti-examples only in balanced mode', () => {
    expect(getModeOverlay('strict')).not.toContain('This is NOT a finding');
    expect(getModeOverlay('detailed')).not.toContain('This is NOT a finding');
    expect(getModeOverlay('lenient')).not.toContain('This is NOT a finding');
  });
});

describe('severity anchoring examples', () => {
  it('buildPrompt includes severity anchoring examples for all 4 levels', () => {
    const prompt = buildPrompt(mockPR);
    expect(prompt).toMatch(/"severity":\s*"bug"/);
    expect(prompt).toMatch(/"severity":\s*"security"/);
    expect(prompt).toMatch(/"severity":\s*"suggestion"/);
    expect(prompt).toMatch(/"severity":\s*"nitpick"/);
  });

  it('buildAgenticPrompt includes severity anchoring examples for all 4 levels', () => {
    const prompt = buildAgenticPrompt(mockPR);
    expect(prompt).toMatch(/"severity":\s*"bug"/);
    expect(prompt).toMatch(/"severity":\s*"security"/);
    expect(prompt).toMatch(/"severity":\s*"suggestion"/);
    expect(prompt).toMatch(/"severity":\s*"nitpick"/);
  });

  it('severity examples identical in quick and agentic prompts', () => {
    const quick = buildPrompt(mockPR);
    const agentic = buildAgenticPrompt(mockPR);
    // Both should contain the shared SEVERITY_EXAMPLES marker
    const marker = 'correctly labeled findings';
    expect(quick).toContain(marker);
    expect(agentic).toContain(marker);
    // Extract the severity examples block from both and compare
    const quickStart = quick.indexOf(marker);
    const agenticStart = agentic.indexOf(marker);
    // Find the end of severity examples (next double-newline paragraph break after marker)
    const quickBlock = quick.slice(quickStart, quick.indexOf('\n\nFocus on the CHANGED code'));
    const agenticBlock = agentic.slice(agenticStart, agentic.indexOf('\n\nReport all issues you find'));
    expect(quickBlock).toBe(agenticBlock);
  });
});

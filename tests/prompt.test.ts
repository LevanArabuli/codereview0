import { describe, it, expect } from 'vitest';
import { getModeOverlay, buildPrompt, buildAgenticPrompt, REVIEW_MODES, ASPECT_TYPES, buildAspectPrompt, buildAspectAgenticPrompt } from '../src/prompt.js';
import type { ReviewMode } from '../src/prompt.js';
import type { PRData } from '../src/types.js';
import { ReviewFindingSchema } from '../src/schemas.js';

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

// ─── Aspect Schema Tests ──────────────────────────────────────────────────────

describe('ReviewFindingSchema aspect field', () => {
  const baseFinding = {
    file: 'src/test.ts',
    line: 10,
    severity: 'bug' as const,
    confidence: 'high' as const,
    category: 'null-safety',
    description: 'Possible null dereference.',
  };

  it('accepts a finding with aspect: "security"', () => {
    const result = ReviewFindingSchema.safeParse({ ...baseFinding, aspect: 'security' });
    expect(result.success).toBe(true);
  });

  it('accepts a finding with aspect: "performance"', () => {
    const result = ReviewFindingSchema.safeParse({ ...baseFinding, aspect: 'performance' });
    expect(result.success).toBe(true);
  });

  it('accepts a finding with aspect: "quality"', () => {
    const result = ReviewFindingSchema.safeParse({ ...baseFinding, aspect: 'quality' });
    expect(result.success).toBe(true);
  });

  it('accepts a finding with aspect: "tests"', () => {
    const result = ReviewFindingSchema.safeParse({ ...baseFinding, aspect: 'tests' });
    expect(result.success).toBe(true);
  });

  it('accepts a finding WITHOUT an aspect field (backwards compatible)', () => {
    const result = ReviewFindingSchema.safeParse(baseFinding);
    expect(result.success).toBe(true);
  });

  it('rejects a finding with aspect: "invalid"', () => {
    const result = ReviewFindingSchema.safeParse({ ...baseFinding, aspect: 'invalid' });
    expect(result.success).toBe(false);
  });
});

// ─── Aspect Types and Overlays ────────────────────────────────────────────────

describe('ASPECT_TYPES', () => {
  it('contains exactly four aspect types', () => {
    expect(ASPECT_TYPES).toHaveLength(4);
  });

  it('includes security, performance, quality, and tests', () => {
    expect(ASPECT_TYPES).toContain('security');
    expect(ASPECT_TYPES).toContain('performance');
    expect(ASPECT_TYPES).toContain('quality');
    expect(ASPECT_TYPES).toContain('tests');
  });
});

describe('Aspect overlays domain scoping', () => {
  it('security overlay contains domain-specific keywords', () => {
    const prompt = buildAspectPrompt(mockPR, 'balanced', 'security');
    expect(prompt).toMatch(/vulnerabilities/i);
    expect(prompt).toMatch(/injection/i);
    expect(prompt).toMatch(/authentication/i);
  });

  it('performance overlay contains domain-specific keywords', () => {
    const prompt = buildAspectPrompt(mockPR, 'balanced', 'performance');
    expect(prompt).toMatch(/bottlenecks/i);
    expect(prompt).toMatch(/allocations/i);
    expect(prompt).toMatch(/memory/i);
  });

  it('quality overlay contains domain-specific keywords', () => {
    const prompt = buildAspectPrompt(mockPR, 'balanced', 'quality');
    expect(prompt).toMatch(/readability/i);
    expect(prompt).toMatch(/maintainability/i);
    expect(prompt).toMatch(/naming/i);
  });

  it('tests overlay contains domain-specific keywords', () => {
    const prompt = buildAspectPrompt(mockPR, 'balanced', 'tests');
    expect(prompt).toMatch(/test coverage/i);
    expect(prompt).toMatch(/edge case/i);
    expect(prompt).toMatch(/error paths/i);
  });

  it('aspect overlays do NOT restate JSON output format instructions', () => {
    for (const aspect of ASPECT_TYPES) {
      const withAspect = buildAspectPrompt(mockPR, 'balanced', aspect);
      const withoutAspect = buildAspectPrompt(mockPR, 'balanced');
      // The aspect overlay part (the diff) should not contain JSON format instructions
      const overlayPart = withAspect.slice(withoutAspect.length);
      expect(overlayPart).not.toContain('IMPORTANT: Respond with ONLY a valid JSON');
      expect(overlayPart).not.toContain('"findings"');
    }
  });
});

// ─── buildAspectPrompt ────────────────────────────────────────────────────────

describe('buildAspectPrompt', () => {
  it('returns base prompt + mode overlay + aspect overlay when all three provided', () => {
    const prompt = buildAspectPrompt(mockPR, 'strict', 'security');
    // Should contain base prompt content
    expect(prompt).toContain('Test PR');
    // Should contain mode overlay
    expect(prompt).toContain('REVIEW MODE');
    // Should contain aspect overlay
    expect(prompt).toMatch(/ASPECT FOCUS/i);
  });

  it('without aspect returns same as buildPrompt (backwards compatible)', () => {
    const aspectPrompt = buildAspectPrompt(mockPR, 'strict');
    const regularPrompt = buildPrompt(mockPR, 'strict');
    expect(aspectPrompt).toBe(regularPrompt);
  });

  it('without aspect and without mode returns same as buildPrompt with no args', () => {
    const aspectPrompt = buildAspectPrompt(mockPR);
    const regularPrompt = buildPrompt(mockPR);
    expect(aspectPrompt).toBe(regularPrompt);
  });
});

// ─── buildAspectAgenticPrompt ─────────────────────────────────────────────────

describe('buildAspectAgenticPrompt', () => {
  it('returns agentic base prompt + mode overlay + aspect overlay', () => {
    const prompt = buildAspectAgenticPrompt(mockPR, 'strict', 'security');
    // Should contain agentic-specific content
    expect(prompt).toContain('## Codebase Exploration');
    // Should contain mode overlay
    expect(prompt).toContain('REVIEW MODE');
    // Should contain aspect overlay
    expect(prompt).toMatch(/ASPECT FOCUS/i);
  });

  it('without aspect returns same as buildAgenticPrompt (backwards compatible)', () => {
    const aspectPrompt = buildAspectAgenticPrompt(mockPR, 'strict');
    const regularPrompt = buildAgenticPrompt(mockPR, 'strict');
    expect(aspectPrompt).toBe(regularPrompt);
  });

  it('without aspect and without mode returns same as buildAgenticPrompt with no args', () => {
    const aspectPrompt = buildAspectAgenticPrompt(mockPR);
    const regularPrompt = buildAgenticPrompt(mockPR);
    expect(aspectPrompt).toBe(regularPrompt);
  });
});

import { describe, it, expect } from 'vitest';
import { getModeOverlay, buildPrompt, buildDeepPrompt, REVIEW_MODES } from '../src/prompt.js';
import type { ReviewMode } from '../src/prompt.js';
import type { PRData } from '../src/types.js';

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
    expect(overlay).toMatch(/not report nitpicks|do not.*nitpick/i);
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

  it('same mode produces same overlay for quick and deep prompts', () => {
    const quickPrompt = buildPrompt(mockPR, 'strict');
    const deepPrompt = buildDeepPrompt(mockPR, 'strict');
    const overlay = getModeOverlay('strict');
    expect(quickPrompt).toContain(overlay);
    expect(deepPrompt).toContain(overlay);
  });
});

describe('buildDeepPrompt with mode', () => {
  it('includes mode overlay in output', () => {
    const prompt = buildDeepPrompt(mockPR, 'detailed');
    const overlay = getModeOverlay('detailed');
    expect(prompt).toContain(overlay);
  });

  it('defaults to balanced overlay when mode is undefined', () => {
    const prompt = buildDeepPrompt(mockPR);
    const balancedOverlay = getModeOverlay('balanced');
    expect(prompt).toContain(balancedOverlay);
  });

  it('includes base deep prompt content regardless of mode', () => {
    for (const mode of REVIEW_MODES) {
      const prompt = buildDeepPrompt(mockPR, mode);
      expect(prompt).toContain('deep codebase analysis');
      expect(prompt).toContain('Test PR');
      expect(prompt).toContain('cross-file');
    }
  });
});

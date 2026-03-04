import { describe, it, expect } from 'vitest';
import { buildReviewBody, partitionFindings } from '../src/review-builder.js';
import type { ReviewFinding } from '../src/schemas.js';
import type { DiffHunk } from '../src/types.js';

function makeFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    file: 'src/foo.ts',
    line: 100,
    severity: 'bug',
    confidence: 'high',
    category: 'Logic Error',
    description: 'Variable is reassigned incorrectly.',
    ...overrides,
  };
}

describe('buildReviewBody', () => {
  it('does NOT include confidence label for high confidence finding', () => {
    const findings = [makeFinding({ confidence: 'high' })];
    const result = buildReviewBody(findings);
    expect(result).not.toContain('[high]');
  });

  it('includes confidence label for medium confidence finding', () => {
    const findings = [makeFinding({ confidence: 'medium' })];
    const result = buildReviewBody(findings);
    expect(result).toContain('`[medium]`');
  });

  it('includes confidence label for low confidence finding', () => {
    const findings = [makeFinding({ confidence: 'low' })];
    const result = buildReviewBody(findings);
    expect(result).toContain('`[low]`');
  });

  it('returns empty string for empty array', () => {
    const result = buildReviewBody([]);
    expect(result).toBe('');
  });

  it('includes file:line location and severity for each finding', () => {
    const findings = [makeFinding({ file: 'src/bar.ts', line: 42, severity: 'security' })];
    const result = buildReviewBody(findings);
    expect(result).toContain('`src/bar.ts:42`');
    expect(result).toContain('**Security**');
  });

  it('medium confidence finding has severity then confidence then location in order', () => {
    const findings = [makeFinding({ severity: 'suggestion', confidence: 'medium', file: 'src/x.ts', line: 7 })];
    const result = buildReviewBody(findings);
    // The line should be: - **Suggestion** `[medium]` `src/x.ts:7` -- ...
    expect(result).toMatch(/\*\*Suggestion\*\* `\[medium\]` `src\/x\.ts:7`/);
  });
});

describe('partitionFindings', () => {
  it('correctly splits inline vs off-diff findings', () => {
    const diffHunks = new Map<string, DiffHunk[]>();
    diffHunks.set('src/foo.ts', [{ newStart: 1, newCount: 10 }]);

    const findings: ReviewFinding[] = [
      makeFinding({ file: 'src/foo.ts', line: 5 }),   // inline (within hunk)
      makeFinding({ file: 'src/foo.ts', line: 100 }), // off-diff (outside hunk)
      makeFinding({ file: 'src/bar.ts', line: 1 }),   // off-diff (no hunks for this file)
    ];

    const result = partitionFindings(findings, diffHunks);
    expect(result.inline).toHaveLength(1);
    expect(result.inline[0].line).toBe(5);
    expect(result.offDiff).toHaveLength(2);
  });
});

import { describe, it, expect } from 'vitest';
import { deduplicateFindings } from '../src/dedup.js';
import type { ReviewFinding } from '../src/schemas.js';

/** Helper to create a ReviewFinding with defaults */
function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: 'src/app.ts',
    line: 10,
    severity: 'suggestion',
    confidence: 'medium',
    category: 'error-handling',
    description: 'Missing error handler.',
    ...overrides,
  };
}

describe('deduplicateFindings', () => {
  it('keeps only the highest-severity finding at same file+line+category', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ severity: 'nitpick' }),
      makeFinding({ severity: 'bug' }),
      makeFinding({ severity: 'suggestion' }),
    ];
    const { deduplicated } = deduplicateFindings(findings);
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].severity).toBe('bug');
  });

  it('uses severity ranking: bug > security > suggestion > nitpick', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ severity: 'security' }),
      makeFinding({ severity: 'suggestion' }),
    ];
    const { deduplicated } = deduplicateFindings(findings);
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].severity).toBe('security');
  });

  it('breaks same-severity ties by confidence (higher wins)', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ severity: 'bug', confidence: 'low' }),
      makeFinding({ severity: 'bug', confidence: 'high' }),
      makeFinding({ severity: 'bug', confidence: 'medium' }),
    ];
    const { deduplicated } = deduplicateFindings(findings);
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].confidence).toBe('high');
  });

  it('keeps first encountered when severity and confidence are equal', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ severity: 'bug', confidence: 'high', description: 'First' }),
      makeFinding({ severity: 'bug', confidence: 'high', description: 'Second' }),
    ];
    const { deduplicated } = deduplicateFindings(findings);
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].description).toBe('First');
  });

  it('does not merge findings at different lines in the same file and category', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ line: 10 }),
      makeFinding({ line: 20 }),
    ];
    const { deduplicated } = deduplicateFindings(findings);
    expect(deduplicated).toHaveLength(2);
  });

  it('does not merge findings at same line but different categories', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ category: 'error-handling' }),
      makeFinding({ category: 'performance' }),
    ];
    const { deduplicated } = deduplicateFindings(findings);
    expect(deduplicated).toHaveLength(2);
  });

  it('deduplicates bug and security at same location (bug wins)', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ severity: 'security', confidence: 'high' }),
      makeFinding({ severity: 'bug', confidence: 'high' }),
    ];
    const { deduplicated } = deduplicateFindings(findings);
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0].severity).toBe('bug');
  });

  it('returns empty array with removedCount 0 for empty input', () => {
    const { deduplicated, removedCount } = deduplicateFindings([]);
    expect(deduplicated).toEqual([]);
    expect(removedCount).toBe(0);
  });

  it('returns single finding unchanged with removedCount 0', () => {
    const finding = makeFinding();
    const { deduplicated, removedCount } = deduplicateFindings([finding]);
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0]).toEqual(finding);
    expect(removedCount).toBe(0);
  });

  it('does not mutate the input array', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ severity: 'nitpick' }),
      makeFinding({ severity: 'bug' }),
    ];
    const original = [...findings];
    deduplicateFindings(findings);
    expect(findings).toEqual(original);
    expect(findings).toHaveLength(2);
  });

  it('removedCount equals input.length minus output.length', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ severity: 'nitpick' }),
      makeFinding({ severity: 'bug' }),
      makeFinding({ severity: 'suggestion' }),
      makeFinding({ line: 99, severity: 'nitpick' }), // different line, survives
    ];
    const { deduplicated, removedCount } = deduplicateFindings(findings);
    expect(removedCount).toBe(findings.length - deduplicated.length);
    expect(deduplicated).toHaveLength(2); // one at line 10 (bug wins), one at line 99
    expect(removedCount).toBe(2);
  });
});

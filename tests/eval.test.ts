import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { matchFindings, computeMetrics } from '../src/eval.js';
import type { EvalFinding, MatchResult } from '../src/eval.js';
import type { ReviewFinding } from '../src/schemas.js';

// Helper to create a minimal ReviewFinding
function rf(file: string, line: number, overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    file,
    line,
    severity: 'suggestion',
    confidence: 'medium',
    category: 'test',
    description: `Finding at ${file}:${line}`,
    ...overrides,
  };
}

// Helper to create a minimal EvalFinding
function ef(file: string, line: number, classification: 'GOOD' | 'MEH' | 'BAD' = 'GOOD', overrides?: Partial<EvalFinding>): EvalFinding {
  return {
    file,
    line,
    severity: 'suggestion',
    category: 'test',
    classification,
    ...overrides,
  };
}

describe('matchFindings', () => {
  it('matches findings in same file within 5-line window', () => {
    const actual = [rf('a.ts', 12)];
    const expected = [ef('a.ts', 10)];
    const result = matchFindings(actual, expected);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].actual).not.toBeNull();
    expect(result.matched[0].distance).toBe(2);
    expect(result.unmatched_actual).toHaveLength(0);
  });

  it('does not match findings in same file beyond 5-line window', () => {
    const actual = [rf('a.ts', 20)];
    const expected = [ef('a.ts', 10)];
    const result = matchFindings(actual, expected);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].actual).toBeNull();
    expect(result.matched[0].distance).toBe(-1);
    expect(result.unmatched_actual).toHaveLength(1);
    expect(result.unmatched_actual[0].line).toBe(20);
  });

  it('does not match findings in different files', () => {
    const actual = [rf('b.ts', 10)];
    const expected = [ef('a.ts', 10)];
    const result = matchFindings(actual, expected);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].actual).toBeNull();
    expect(result.unmatched_actual).toHaveLength(1);
  });

  it('matches at exact boundary of 5-line window', () => {
    const actual = [rf('a.ts', 15)];
    const expected = [ef('a.ts', 10)];
    const result = matchFindings(actual, expected);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].actual).not.toBeNull();
    expect(result.matched[0].distance).toBe(5);
  });

  it('does not match at distance 6 (just outside window)', () => {
    const actual = [rf('a.ts', 16)];
    const expected = [ef('a.ts', 10)];
    const result = matchFindings(actual, expected);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].actual).toBeNull();
    expect(result.matched[0].distance).toBe(-1);
  });

  it('selects closest candidate when multiple actuals match same expected', () => {
    const actual = [rf('a.ts', 12), rf('a.ts', 14)];
    const expected = [ef('a.ts', 10)];
    const result = matchFindings(actual, expected);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].actual).not.toBeNull();
    expect(result.matched[0].distance).toBe(2); // line 12 is closer
    expect(result.unmatched_actual).toHaveLength(1);
    expect(result.unmatched_actual[0].line).toBe(14);
  });

  it('assigns each actual finding to at most one expected (greedy closest-first)', () => {
    const actual = [rf('a.ts', 11)];
    const expected = [ef('a.ts', 10), ef('a.ts', 12)];
    const result = matchFindings(actual, expected);

    // The actual at line 11 should be matched to line 10 (distance 1) or line 12 (distance 1)
    // Greedy: expected sorted by (file, line), so line 10 is processed first, gets the match
    const matchedWithActual = result.matched.filter(m => m.actual !== null);
    expect(matchedWithActual).toHaveLength(1);
    expect(matchedWithActual[0].expected.line).toBe(10);
    expect(matchedWithActual[0].distance).toBe(1);

    // The second expected finding (line 12) should be unmatched
    const unmatchedExpected = result.matched.filter(m => m.actual === null);
    expect(unmatchedExpected).toHaveLength(1);
    expect(unmatchedExpected[0].expected.line).toBe(12);
  });

  it('handles empty actual array', () => {
    const actual: ReviewFinding[] = [];
    const expected = [ef('a.ts', 10)];
    const result = matchFindings(actual, expected);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].actual).toBeNull();
    expect(result.unmatched_actual).toHaveLength(0);
  });

  it('handles empty expected array', () => {
    const actual = [rf('a.ts', 10)];
    const expected: EvalFinding[] = [];
    const result = matchFindings(actual, expected);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched_actual).toHaveLength(1);
  });

  it('handles both arrays empty', () => {
    const result = matchFindings([], []);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched_actual).toHaveLength(0);
  });

  it('sorts expected by file then line for determinism', () => {
    const actual = [rf('b.ts', 5), rf('a.ts', 5)];
    const expected = [ef('b.ts', 5), ef('a.ts', 5)];
    const result = matchFindings(actual, expected);

    // Both should match regardless of input order
    expect(result.matched).toHaveLength(2);
    expect(result.matched.every(m => m.actual !== null)).toBe(true);
    expect(result.unmatched_actual).toHaveLength(0);

    // Matched should be in sorted order (a.ts before b.ts)
    expect(result.matched[0].expected.file).toBe('a.ts');
    expect(result.matched[1].expected.file).toBe('b.ts');
  });

  it('handles exact line match (distance 0)', () => {
    const actual = [rf('a.ts', 10)];
    const expected = [ef('a.ts', 10)];
    const result = matchFindings(actual, expected);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].distance).toBe(0);
  });
});

describe('computeMetrics', () => {
  it('computes perfect scores when all GOOD expected are matched', () => {
    const result: MatchResult = {
      matched: [
        { expected: ef('a.ts', 10, 'GOOD'), actual: rf('a.ts', 10), distance: 0 },
        { expected: ef('b.ts', 20, 'GOOD'), actual: rf('b.ts', 20), distance: 0 },
      ],
      unmatched_actual: [],
    };
    const metrics = computeMetrics(result);

    expect(metrics.precision).toBe(1.0);
    expect(metrics.recall).toBe(1.0);
    expect(metrics.hallucinationRate).toBe(0);
  });

  it('computes zero recall when all GOOD expected are missed', () => {
    const result: MatchResult = {
      matched: [
        { expected: ef('a.ts', 10, 'GOOD'), actual: null, distance: -1 },
        { expected: ef('b.ts', 20, 'GOOD'), actual: null, distance: -1 },
      ],
      unmatched_actual: [],
    };
    const metrics = computeMetrics(result);

    expect(metrics.precision).toBe(1.0); // no TP+FP, so 1.0
    expect(metrics.recall).toBe(0);
    expect(metrics.hallucinationRate).toBe(0); // no actuals at all
  });

  it('lowers precision when MEH findings are matched', () => {
    const result: MatchResult = {
      matched: [
        { expected: ef('a.ts', 10, 'GOOD'), actual: rf('a.ts', 10), distance: 0 },
        { expected: ef('b.ts', 20, 'MEH'), actual: rf('b.ts', 20), distance: 0 },
      ],
      unmatched_actual: [],
    };
    const metrics = computeMetrics(result);

    // TP=1, FP=1 -> precision = 1/2 = 0.5
    expect(metrics.precision).toBe(0.5);
    expect(metrics.recall).toBe(1.0); // 1 GOOD matched out of 1 GOOD total
  });

  it('lowers precision when BAD findings are matched', () => {
    const result: MatchResult = {
      matched: [
        { expected: ef('a.ts', 10, 'GOOD'), actual: rf('a.ts', 10), distance: 0 },
        { expected: ef('b.ts', 20, 'BAD'), actual: rf('b.ts', 20), distance: 0 },
      ],
      unmatched_actual: [],
    };
    const metrics = computeMetrics(result);

    // TP=1, FP=1 -> precision = 0.5
    expect(metrics.precision).toBe(0.5);
  });

  it('increases hallucination rate with unmatched actuals', () => {
    const result: MatchResult = {
      matched: [
        { expected: ef('a.ts', 10, 'GOOD'), actual: rf('a.ts', 10), distance: 0 },
      ],
      unmatched_actual: [rf('c.ts', 30), rf('d.ts', 40)],
    };
    const metrics = computeMetrics(result);

    // totalActual = 1 matched + 2 unmatched = 3
    // hallucinationRate = 2/3
    expect(metrics.hallucinationRate).toBeCloseTo(2 / 3, 5);
  });

  it('returns perfect metrics for empty inputs', () => {
    const result: MatchResult = {
      matched: [],
      unmatched_actual: [],
    };
    const metrics = computeMetrics(result);

    expect(metrics.precision).toBe(1.0);
    expect(metrics.recall).toBe(1.0);
    expect(metrics.hallucinationRate).toBe(0);
  });

  it('handles only unmatched actuals (all hallucinations)', () => {
    const result: MatchResult = {
      matched: [],
      unmatched_actual: [rf('a.ts', 10), rf('b.ts', 20)],
    };
    const metrics = computeMetrics(result);

    // No expected, so precision = 1.0, recall = 1.0
    expect(metrics.precision).toBe(1.0);
    expect(metrics.recall).toBe(1.0);
    // hallucinationRate = 2/2 = 1.0
    expect(metrics.hallucinationRate).toBe(1.0);
  });

  it('handles mixed scenario with all classification types', () => {
    const result: MatchResult = {
      matched: [
        { expected: ef('a.ts', 10, 'GOOD'), actual: rf('a.ts', 10), distance: 0 },  // TP
        { expected: ef('b.ts', 20, 'GOOD'), actual: null, distance: -1 },            // FN
        { expected: ef('c.ts', 30, 'MEH'), actual: rf('c.ts', 30), distance: 0 },    // FP
        { expected: ef('d.ts', 40, 'BAD'), actual: rf('d.ts', 40), distance: 0 },    // FP
      ],
      unmatched_actual: [rf('e.ts', 50)],                                             // hallucination
    };
    const metrics = computeMetrics(result);

    // TP=1, FP=2, FN=1
    // precision = 1/(1+2) = 1/3
    expect(metrics.precision).toBeCloseTo(1 / 3, 5);
    // recall = 1/(1+1) = 0.5
    expect(metrics.recall).toBe(0.5);
    // totalActual = 3 matched with actual + 1 unmatched = 4
    // hallucinationRate = 1/4 = 0.25
    expect(metrics.hallucinationRate).toBe(0.25);
  });

  it('unmatched MEH/BAD do not count as FN', () => {
    const result: MatchResult = {
      matched: [
        { expected: ef('a.ts', 10, 'MEH'), actual: null, distance: -1 },
        { expected: ef('b.ts', 20, 'BAD'), actual: null, distance: -1 },
      ],
      unmatched_actual: [],
    };
    const metrics = computeMetrics(result);

    // No GOOD findings at all -> recall = 1.0 (vacuously true)
    expect(metrics.recall).toBe(1.0);
    // No actuals -> precision = 1.0
    expect(metrics.precision).toBe(1.0);
  });
});

describe('evaluation: PR fixtures', () => {
  const require = createRequire(import.meta.url);
  const pr1Fixture = require('./fixtures/pr-1-small.json');
  const pr2Fixture = require('./fixtures/pr-2-medium.json');
  const pr3Fixture = require('./fixtures/pr-3-large.json');

  it('self-matches pr-1-small fixture with perfect recall for GOOD findings', () => {
    // Convert expected findings to ReviewFinding shape for actual parameter
    const asActual: ReviewFinding[] = pr1Fixture.expected_findings.map((f: EvalFinding) => rf(f.file, f.line, {
      severity: f.severity as ReviewFinding['severity'],
      category: f.category,
    }));
    const result = matchFindings(asActual, pr1Fixture.expected_findings);

    const metrics = computeMetrics(result);
    // Self-match: all findings should match themselves
    expect(metrics.recall).toBe(1.0);
    expect(metrics.hallucinationRate).toBe(0);
  });

  it('self-matches pr-2-medium fixture with perfect recall for GOOD findings', () => {
    const asActual: ReviewFinding[] = pr2Fixture.expected_findings.map((f: EvalFinding) => rf(f.file, f.line, {
      severity: f.severity as ReviewFinding['severity'],
      category: f.category,
    }));
    const result = matchFindings(asActual, pr2Fixture.expected_findings);

    const metrics = computeMetrics(result);
    expect(metrics.recall).toBe(1.0);
    expect(metrics.hallucinationRate).toBe(0);
  });

  it('self-matches pr-3-large fixture with perfect recall for GOOD findings', () => {
    const asActual: ReviewFinding[] = pr3Fixture.expected_findings.map((f: EvalFinding) => rf(f.file, f.line, {
      severity: f.severity as ReviewFinding['severity'],
      category: f.category,
    }));
    const result = matchFindings(asActual, pr3Fixture.expected_findings);

    const metrics = computeMetrics(result);
    expect(metrics.recall).toBe(1.0);
    expect(metrics.hallucinationRate).toBe(0);
  });

  it('all fixture files have expected_findings with classification labels', () => {
    for (const fixture of [pr1Fixture, pr2Fixture, pr3Fixture]) {
      expect(fixture.expected_findings.length).toBeGreaterThan(0);
      for (const finding of fixture.expected_findings) {
        expect(['GOOD', 'MEH', 'BAD']).toContain(finding.classification);
        expect(finding.file).toBeDefined();
        expect(finding.line).toBeDefined();
      }
    }
  });
});

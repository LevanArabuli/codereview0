import type { ReviewFinding } from './schemas.js';

/** An expected finding from evaluation fixtures with classification label */
export interface EvalFinding {
  file: string;
  line: number;
  severity: string;
  category: string;
  classification: 'GOOD' | 'MEH' | 'BAD';
  is_cross_file?: boolean;
}

/** A pairing of an expected finding to an actual finding (or null if unmatched) */
export interface FindingMatch {
  expected: EvalFinding;
  actual: ReviewFinding | null;
  distance: number; // -1 if unmatched
}

/** Result of matching actual findings against expected findings */
export interface MatchResult {
  matched: FindingMatch[];
  unmatched_actual: ReviewFinding[];
}

/** Precision, recall, and hallucination rate computed from match results */
export interface EvalMetrics {
  precision: number;
  recall: number;
  hallucinationRate: number;
}

/**
 * Pairs actual findings against expected findings by file path and line proximity.
 *
 * Algorithm: greedy closest-first matching within a 5-line window.
 * Expected findings are sorted by (file, line) before processing for determinism.
 * Each finding matches at most once.
 */
export function matchFindings(actual: ReviewFinding[], expected: EvalFinding[]): MatchResult {
  // Copy actual to remaining pool (each can be consumed at most once)
  const remaining = [...actual];

  // Sort expected by (file, line) for deterministic processing
  const sortedExpected = [...expected].sort((a, b) => {
    const fileCmp = a.file.localeCompare(b.file);
    if (fileCmp !== 0) return fileCmp;
    return a.line - b.line;
  });

  const matched: FindingMatch[] = [];

  for (const exp of sortedExpected) {
    // Find best match in remaining: same file, closest line within 5-line window
    let bestIdx = -1;
    let bestDistance = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const act = remaining[i];
      if (act.file !== exp.file) continue;

      const distance = Math.abs(act.line - exp.line);
      if (distance <= 5 && distance < bestDistance) {
        bestDistance = distance;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      // Match found: consume from remaining
      const matchedActual = remaining.splice(bestIdx, 1)[0];
      matched.push({
        expected: exp,
        actual: matchedActual,
        distance: bestDistance,
      });
    } else {
      // No match: expected finding goes unmatched
      matched.push({
        expected: exp,
        actual: null,
        distance: -1,
      });
    }
  }

  return {
    matched,
    unmatched_actual: remaining,
  };
}

/**
 * Computes precision, recall, and hallucination rate from match results.
 *
 * Definitions:
 * - TP: matched expected GOOD finding with non-null actual
 * - FP: matched expected non-GOOD (MEH/BAD) finding with non-null actual
 * - FN: expected GOOD finding with null actual (missed)
 * - Hallucination: count of unmatched_actual
 *
 * Zero-division guards return 1.0 for precision/recall when denominator is 0,
 * and 0 for hallucinationRate when totalActual is 0.
 */
export function computeMetrics(result: MatchResult): EvalMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const match of result.matched) {
    if (match.actual !== null) {
      if (match.expected.classification === 'GOOD') {
        tp++;
      } else {
        fp++;
      }
    } else {
      if (match.expected.classification === 'GOOD') {
        fn++;
      }
      // Unmatched MEH/BAD do not count as FN
    }
  }

  const hallucinations = result.unmatched_actual.length;

  // Total actual findings = those matched with an actual + unmatched actuals
  const totalActual = result.matched.filter(m => m.actual !== null).length + hallucinations;

  const precision = (tp + fp) === 0 ? 1.0 : tp / (tp + fp);
  const recall = (tp + fn) === 0 ? 1.0 : tp / (tp + fn);
  const hallucinationRate = totalActual === 0 ? 0 : hallucinations / totalActual;

  return {
    precision,
    recall,
    hallucinationRate,
  };
}

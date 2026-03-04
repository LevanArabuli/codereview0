import type { ReviewFinding } from './schemas.js';

/** Severity rank: lower number = higher priority */
const SEVERITY_RANK: Record<string, number> = {
  bug: 0,
  security: 1,
  suggestion: 2,
  nitpick: 3,
};

/** Confidence rank: lower number = higher priority */
const CONFIDENCE_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * Deduplicate findings by file+line+category. When multiple findings share
 * the same composite key, the highest-severity finding wins. Same-severity
 * ties are broken by confidence (higher wins). Same-confidence ties keep
 * the first encountered finding.
 *
 * Returns a new array (input is not mutated) and the count of removed duplicates.
 */
export function deduplicateFindings(
  findings: readonly ReviewFinding[],
): { deduplicated: ReviewFinding[]; removedCount: number } {
  const seen = new Map<string, ReviewFinding>();

  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.category}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, finding);
      continue;
    }

    const sevRankNew = SEVERITY_RANK[finding.severity] ?? 9;
    const sevRankOld = SEVERITY_RANK[existing.severity] ?? 9;

    if (sevRankNew < sevRankOld) {
      // New finding has higher severity -- replace
      seen.set(key, finding);
    } else if (sevRankNew === sevRankOld) {
      const confRankNew = CONFIDENCE_RANK[finding.confidence] ?? 9;
      const confRankOld = CONFIDENCE_RANK[existing.confidence] ?? 9;

      if (confRankNew < confRankOld) {
        // Same severity, new finding has higher confidence -- replace
        seen.set(key, finding);
      }
      // Same confidence: keep existing (first encountered wins)
    }
    // Lower severity: keep existing
  }

  const deduplicated = [...seen.values()];
  return {
    deduplicated,
    removedCount: findings.length - deduplicated.length,
  };
}

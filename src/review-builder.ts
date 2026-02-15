import type { DiffHunk } from './types.js';
import type { ReviewFinding } from './schemas.js';
import { isLineInDiff } from './diff-parser.js';

/**
 * Partition findings into inline (within diff hunks) and off-diff (outside hunks).
 * Inline findings can be posted as GitHub inline comments.
 * Off-diff findings are promoted to the review body.
 */
export function partitionFindings(
  findings: ReviewFinding[],
  diffHunks: Map<string, DiffHunk[]>,
): { inline: ReviewFinding[]; offDiff: ReviewFinding[] } {
  const inline: ReviewFinding[] = [];
  const offDiff: ReviewFinding[] = [];

  for (const finding of findings) {
    const hunks = diffHunks.get(finding.file);
    if (hunks && isLineInDiff(hunks, finding.line)) {
      inline.push(finding);
    } else {
      offDiff.push(finding);
    }
  }

  return { inline, offDiff };
}

/**
 * Build the review body string.
 *
 * Returns empty string when all findings are inline (no off-diff findings).
 * When off-diff findings exist, lists them with capitalized severity.
 *
 * @param offDiffFindings - Findings outside the diff
 */
export function buildReviewBody(offDiffFindings: ReviewFinding[]): string {
  if (offDiffFindings.length === 0) {
    return '';
  }

  let body = '**Findings outside the diff** (cannot be posted as inline comments):\n';
  for (const f of offDiffFindings) {
    const severity = f.severity.charAt(0).toUpperCase() + f.severity.slice(1);
    body += `\n- **${severity}** \`[${f.confidence}]\` \`${f.file}:${f.line}\` -- ${f.description}`;
  }

  return body;
}

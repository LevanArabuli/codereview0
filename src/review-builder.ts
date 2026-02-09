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

/** Severity display order: bug, security, suggestion, nitpick */
const SEVERITY_ORDER = ['bug', 'security', 'suggestion', 'nitpick'] as const;

/** Pluralization rules per severity */
function pluralizeSeverity(severity: string, count: number): string {
  if (severity === 'bug') return count === 1 ? '1 bug' : `${count} bugs`;
  if (severity === 'security') return `${count} security`;
  if (severity === 'suggestion') return count === 1 ? '1 suggestion' : `${count} suggestions`;
  if (severity === 'nitpick') return count === 1 ? '1 nitpick' : `${count} nitpicks`;
  return `${count} ${severity}`;
}

/**
 * Build the review body string with summary line and optional off-diff findings section.
 *
 * @param allFindings - All findings (for summary counts)
 * @param offDiffFindings - Findings outside the diff (for off-diff section)
 */
export function buildReviewBody(
  allFindings: ReviewFinding[],
  offDiffFindings: ReviewFinding[],
): string {
  // Count by severity
  const counts: Record<string, number> = {};
  for (const f of allFindings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }

  // Build severity parts in order
  const parts: string[] = [];
  for (const severity of SEVERITY_ORDER) {
    const count = counts[severity];
    if (count && count > 0) {
      parts.push(pluralizeSeverity(severity, count));
    }
  }

  const total = allFindings.length;
  let body = `Found ${total} issue${total === 1 ? '' : 's'}: ${parts.join(', ')}`;

  // Off-diff section
  if (offDiffFindings.length > 0) {
    body += '\n\n---\n\n**Findings outside the diff** (cannot be posted as inline comments):\n';
    for (const f of offDiffFindings) {
      body += `\n- **${f.severity}** \`[${f.confidence}]\` \`${f.file}:${f.line}\` -- ${f.description}`;
    }
  }

  return body;
}

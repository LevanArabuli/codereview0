import type { ReviewFinding } from './schemas.js';

/**
 * Extract the first 1-2 sentences from a description.
 * Returns the full description if it has 2 or fewer sentences.
 */
function conciseDescription(description: string): string {
  const sentences = description.match(/[^.!?]*[.!?]+/g);
  if (!sentences || sentences.length <= 2) return description.trim();
  return sentences.slice(0, 2).join('').trim();
}

/**
 * Format a finding as a GitHub inline comment body.
 *
 * Structure:
 *   **{Severity}** `[{confidence}]`
 *   (blank line)
 *   1-2 sentence concise description
 *   (optional related locations)
 *   (optional suggestion block)
 */
export function formatInlineComment(finding: ReviewFinding): string {
  const severity = finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1);
  let body = `**${severity}** \`[${finding.confidence}]\`\n\n${conciseDescription(finding.description)}`;

  // Append related locations if present
  if (finding.relatedLocations && finding.relatedLocations.length > 0) {
    body += '\n\n**Related:**';
    for (const loc of finding.relatedLocations) {
      body += `\n- \`${loc.file}:${loc.line}\` -- ${loc.reason}`;
    }
  }

  // Append suggestion block if present
  if (finding.suggestedFix !== undefined) {
    // If suggestedFix contains triple backticks, use quadruple backticks as delimiter
    const delimiter = finding.suggestedFix.includes('```') ? '````' : '```';
    body += `\n\n${delimiter}suggestion\n${finding.suggestedFix}\n${delimiter}`;
  }

  return body;
}

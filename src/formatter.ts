import type { ReviewFinding } from './schemas.js';

/**
 * Format a finding as a GitHub inline comment body.
 *
 * Structure:
 *   **{Severity}** `[{confidence}]`
 *   (blank line)
 *   full finding description
 *   (optional related locations)
 *   (optional suggestion block)
 */
export function formatInlineComment(finding: ReviewFinding): string {
  const severity = finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1);
  let body = `**${severity}** \`[${finding.confidence}]\`\n\n${finding.description}`;

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

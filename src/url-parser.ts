import type { ParsedPR } from './types.js';

const PR_URL_REGEX =
  /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/pull\/(\d+)\/?(?:\?.*)?(?:#.*)?$/;

/**
 * Parse a GitHub PR URL into its components.
 *
 * Accepts full GitHub PR URLs like:
 *   https://github.com/owner/repo/pull/123
 *   https://github.com/owner/repo/pull/123/
 *   https://github.com/owner/repo/pull/123?query=1
 *   https://github.com/owner/repo/pull/123#discussion
 *
 * Returns null for any invalid, malformed, or non-GitHub input.
 */
export function parsePRUrl(input: string): ParsedPR | null {
  // Validate it's a proper URL first
  try {
    new URL(input);
  } catch {
    return null;
  }

  const match = input.match(PR_URL_REGEX);
  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
}

/** Exit code for missing prerequisites (gh CLI, claude CLI, auth) */
export const EXIT_PREREQ = 1;

/** Exit code for invalid or malformed PR URL */
export const EXIT_INVALID_URL = 2;

/** Exit code for GitHub API failures */
export const EXIT_API_ERROR = 3;

/** Exit code for analysis failures (Claude CLI invocation or response parsing) */
export const EXIT_ANALYSIS_ERROR = 4;

/**
 * Scrub secrets and credentials from a string.
 * Replaces known token/key patterns with [REDACTED].
 * Always scrubs -- no exceptions, even in --verbose mode.
 */
export function scrubSecrets(text: string): string {
  return text
    // GitHub classic tokens (ghp_, gho_, ghs_, ghr_, ghu_)
    .replace(/\b(ghp_|gho_|ghs_|ghr_|ghu_)[a-zA-Z0-9_]+/g, '[REDACTED]')
    // GitHub fine-grained PATs
    .replace(/\bgithub_pat_[a-zA-Z0-9_]+/g, '[REDACTED]')
    // Anthropic API keys
    .replace(/\bsk-ant-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    // Bearer/token auth headers
    .replace(/(Bearer|token)\s+[a-zA-Z0-9._\-]+/gi, '$1 [REDACTED]')
    // URL-embedded credentials
    .replace(/https?:\/\/[^@\s]+@/g, 'https://[REDACTED]@');
}

/**
 * Extract a safe error message from an unknown error value.
 * Converts to string, then scrubs any embedded secrets.
 */
export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return scrubSecrets(message);
}

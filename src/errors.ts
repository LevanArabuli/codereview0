/** Exit code for missing prerequisites (gh CLI, claude CLI, auth) */
export const EXIT_PREREQ = 1;

/** Exit code for invalid or malformed PR URL */
export const EXIT_INVALID_URL = 2;

/** Exit code for GitHub API failures */
export const EXIT_API_ERROR = 3;

/** Exit code for analysis failures (Claude CLI invocation or response parsing) */
export const EXIT_ANALYSIS_ERROR = 4;

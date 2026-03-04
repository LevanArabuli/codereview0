/** Parsed components from a GitHub PR URL */
export interface ParsedPR {
  owner: string;
  repo: string;
  prNumber: number;
}

/** Full PR data fetched from GitHub API */
export interface PRData {
  number: number;
  title: string;
  body: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  headRepoOwner: string;
  headRepoName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: PRFile[];
  diff: string;
}

/** Per-file change information from a PR */
export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

/** A prerequisite check failure with actionable help */
export interface PrereqFailure {
  name: string;
  message: string;
  help: string;
}

/** A hunk range from a unified diff (new-file side) */
export interface DiffHunk {
  newStart: number;
  newCount: number;
}

/** A related file fetched for context enrichment */
export interface RelatedFile {
  path: string;
  content: string;
  reason: 'import' | 'test' | 'type' | 'barrel';
}

/** Per-file exploration guidance for deep mode */
export interface ExplorationCategory {
  file: string;
  categories: string[];  // e.g., ['callers', 'tests', 'type-definitions']
}

/** Shared context data contract between quick and deep review modes */
export interface ReviewContext {
  relatedFiles?: RelatedFile[];           // Quick mode: fetched file contents
  explorationGuidance?: ExplorationCategory[]; // Deep mode: structured guidance
  intent?: string;                        // PR intent category for review calibration
}

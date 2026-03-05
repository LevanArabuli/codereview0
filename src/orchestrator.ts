import { ASPECT_TYPES, type AspectType } from './prompt.js';
import type { ReviewFinding } from './schemas.js';
import type { AnalysisResult } from './analyzer.js';
import { analyzeDiff, analyzeAgentic } from './analyzer.js';
import type { PRData } from './types.js';
import type { ReviewMode } from './prompt.js';

/**
 * Result from a multi-aspect team review.
 * Contains deduplicated findings, per-aspect status, and pre-dedup count.
 */
export interface TeamResult {
  findings: ReviewFinding[];
  model: string;
  aspectStatus: Record<AspectType, 'done' | 'failed'>;
  rawCount: number;
  allFailed: boolean;
}

/**
 * Compute Levenshtein distance between two strings.
 * Standard Wagner-Fischer dynamic programming algorithm.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Compute normalized similarity between two description strings.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
function descriptionSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Severity ordering for dedup priority (lower = higher severity) */
const SEVERITY_ORDER: Record<string, number> = {
  bug: 0,
  security: 1,
  suggestion: 2,
  nitpick: 3,
};

/**
 * Deduplicate findings that overlap in file, line proximity, and description.
 *
 * Findings are sorted by severity (highest first) so that when duplicates
 * are collapsed, the higher-severity finding is kept. Two findings are
 * considered duplicates when:
 * - Same file
 * - Lines within 3 of each other
 * - Description similarity > 0.6 (Levenshtein-based)
 */
export function deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
  // Sort by severity (highest first) so higher severity wins during dedup
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  const kept: ReviewFinding[] = [];
  for (const finding of sorted) {
    const isDuplicate = kept.some(
      (existing) =>
        existing.file === finding.file &&
        Math.abs(existing.line - finding.line) <= 3 &&
        descriptionSimilarity(existing.description, finding.description) > 0.6,
    );
    if (!isDuplicate) {
      kept.push(finding);
    }
  }
  return kept;
}

/**
 * Fan out analysis to all four aspect agents concurrently.
 *
 * Uses Promise.allSettled to ensure partial failures do not abort other agents.
 * Stamps each finding with its originating aspect, deduplicates overlapping
 * findings, and returns a TeamResult with per-aspect status.
 */
async function fanOut(
  analyzeOne: (aspect: AspectType) => Promise<AnalysisResult>,
): Promise<TeamResult> {
  const settled = await Promise.allSettled(
    ASPECT_TYPES.map((aspect) =>
      analyzeOne(aspect).then((result) => ({ aspect, result })),
    ),
  );

  const allFindings: ReviewFinding[] = [];
  const aspectStatus = {} as Record<AspectType, 'done' | 'failed'>;
  let model = 'unknown';

  for (const [i, outcome] of settled.entries()) {
    const aspect = ASPECT_TYPES[i];
    if (outcome.status === 'fulfilled') {
      const stamped = outcome.value.result.findings.map((f) => ({ ...f, aspect }));
      allFindings.push(...stamped);
      aspectStatus[aspect] = 'done';
      model = outcome.value.result.model;
    } else {
      aspectStatus[aspect] = 'failed';
    }
  }

  const allFailed = Object.values(aspectStatus).every((s) => s === 'failed');
  const rawCount = allFindings.length;
  const deduplicated = deduplicateFindings(allFindings);

  return { findings: deduplicated, model, aspectStatus, rawCount, allFailed };
}

/**
 * Run a multi-aspect quick review by fanning out analyzeDiff to four
 * parallel aspect agents (security, performance, quality, tests).
 *
 * Each agent receives a domain-specific prompt overlay. Results are
 * merged, deduplicated, and returned as a TeamResult.
 */
export async function analyzeTeamQuick(
  prData: PRData,
  model?: string,
  mode?: ReviewMode,
): Promise<TeamResult> {
  return fanOut(async (aspect) => {
    return analyzeDiff(prData, model, mode, aspect);
  });
}

/**
 * Run a multi-aspect deep (agentic) review by fanning out analyzeAgentic
 * to four parallel aspect agents (security, performance, quality, tests).
 *
 * Each agent receives a domain-specific prompt overlay and access to the
 * cloned repository. Results are merged, deduplicated, and returned as
 * a TeamResult.
 */
export async function analyzeTeamDeep(
  prData: PRData,
  clonePath: string,
  model?: string,
  mode?: ReviewMode,
  verbose?: boolean,
): Promise<TeamResult> {
  return fanOut(async (aspect) => {
    return analyzeAgentic(prData, clonePath, model, mode, verbose, aspect);
  });
}

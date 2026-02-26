import type { DiffHunk } from './types.js';

/** Matches a diff file header: diff --git a/path b/path */
export const FILE_HEADER_RE = /^diff --git a\/.+ b\/(.+)$/;

/** Matches a hunk header: @@ -oldStart[,oldCount] +newStart[,newCount] @@ */
export const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified diff string and return a Map from filename to array of DiffHunk.
 * Each DiffHunk captures the new-file side range (newStart, newCount).
 */
export function parseDiffHunks(diff: string): Map<string, DiffHunk[]> {
  const result = new Map<string, DiffHunk[]>();
  let currentFile: string | null = null;

  for (const line of diff.split('\n')) {
    const fileMatch = line.match(FILE_HEADER_RE);
    if (fileMatch) {
      currentFile = fileMatch[1];
      if (!result.has(currentFile)) {
        result.set(currentFile, []);
      }
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch && currentFile) {
      const newStart = parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      result.get(currentFile)!.push({ newStart, newCount });
    }
  }

  return result;
}

/**
 * Check whether a line number falls within any of the given diff hunks.
 * Returns true if `line >= hunk.newStart && line < hunk.newStart + hunk.newCount`
 * for any hunk in the array.
 */
export function isLineInDiff(hunks: DiffHunk[], line: number): boolean {
  return hunks.some(
    (hunk) => line >= hunk.newStart && line < hunk.newStart + hunk.newCount,
  );
}

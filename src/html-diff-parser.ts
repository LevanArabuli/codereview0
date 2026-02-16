/**
 * Detailed unified diff parser for HTML rendering.
 *
 * Unlike diff-parser.ts (which only extracts hunk ranges for line-in-diff checking),
 * this module produces per-line structured data: line type, both old and new line numbers,
 * and raw content without the +/- prefix. Suitable for rendering side-by-side or
 * inline diff views in HTML reports.
 */

export interface DiffLine {
  type: 'context' | 'addition' | 'deletion' | 'hunk-header';
  oldLineNum: number | null;
  newLineNum: number | null;
  content: string;
}

export interface DiffFile {
  filename: string;
  oldFilename: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  lines: DiffLine[];
}

/** Matches a diff file header: diff --git a/path b/path */
const FILE_HEADER_RE = /^diff --git a\/.+ b\/(.+)$/;

/** Matches a hunk header: @@ -oldStart[,oldCount] +newStart[,newCount] @@ ... */
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse a unified diff string into structured per-file, per-line data.
 *
 * Returns one DiffFile per file in the diff. Each DiffFile contains an array
 * of DiffLine entries with accurate line numbers tracked independently for
 * old and new sides across multiple hunks.
 */
export function parseDetailedDiff(rawDiff: string): DiffFile[] {
  if (!rawDiff || !rawDiff.trim()) {
    return [];
  }

  const lines = rawDiff.split('\n');
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {

    // File boundary: diff --git a/... b/...
    const fileMatch = line.match(FILE_HEADER_RE);
    if (fileMatch) {
      current = {
        filename: fileMatch[1],
        oldFilename: fileMatch[1],
        status: 'modified',
        lines: [],
      };
      files.push(current);
      continue;
    }

    if (!current) continue;

    // Rename detection
    if (line.startsWith('rename from ')) {
      current.oldFilename = line.slice('rename from '.length);
      current.status = 'renamed';
      continue;
    }
    if (line.startsWith('rename to ')) {
      current.filename = line.slice('rename to '.length);
      current.status = 'renamed';
      continue;
    }

    // New file detection
    if (line.startsWith('--- /dev/null')) {
      current.status = 'added';
      continue;
    }

    // Deleted file detection
    if (line.startsWith('+++ /dev/null')) {
      current.status = 'deleted';
      continue;
    }

    // Skip metadata lines
    if (
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('dissimilarity index') ||
      line.startsWith('Binary files')
    ) {
      continue;
    }

    // Skip "\ No newline at end of file"
    if (line.startsWith('\\ ')) {
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      oldLineNum = parseInt(hunkMatch[1], 10);
      newLineNum = parseInt(hunkMatch[3], 10);
      current.lines.push({
        type: 'hunk-header',
        oldLineNum: null,
        newLineNum: null,
        content: line,
      });
      continue;
    }

    // Content lines
    if (line.startsWith('+')) {
      current.lines.push({
        type: 'addition',
        oldLineNum: null,
        newLineNum: newLineNum,
        content: line.slice(1),
      });
      newLineNum++;
    } else if (line.startsWith('-')) {
      current.lines.push({
        type: 'deletion',
        oldLineNum: oldLineNum,
        newLineNum: null,
        content: line.slice(1),
      });
      oldLineNum++;
    } else if (line.startsWith(' ')) {
      current.lines.push({
        type: 'context',
        oldLineNum: oldLineNum,
        newLineNum: newLineNum,
        content: line.slice(1),
      });
      oldLineNum++;
      newLineNum++;
    }
  }

  return files;
}

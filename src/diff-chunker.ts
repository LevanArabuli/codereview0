import type { PRFile } from './types.js';
import { FILE_HEADER_RE } from './diff-parser.js';

/**
 * A contiguous group of whole file diffs, small enough to review in a single
 * focused Claude call. Files are never split across chunks.
 */
export interface DiffChunk {
  diff: string;
  files: PRFile[];
}

/** Result of splitting a PR diff: the chunks to review plus the files left out. */
export interface ChunkPlan {
  chunks: DiffChunk[];
  /** Noise files (lockfiles, generated output) excluded from review. */
  skipped: PRFile[];
}

/** Lockfile basenames -- large, machine-generated, and not worth a review pass. */
const LOCKFILE_NAMES = new Set([
  'yarn.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'npm-shrinkwrap.json',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Pipfile.lock',
  'Cargo.lock',
  'go.sum',
]);

/**
 * Decide whether a file is review noise (lockfile, generated, or minified
 * output) and should be excluded from chunking. Conservative by design --
 * heuristics that match clearly machine-produced artifacts only.
 */
export function isNoiseFile(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  if (LOCKFILE_NAMES.has(base)) return true;
  if (path.includes('/generated/')) return true;
  if (/\.min\.(js|css)$/.test(base)) return true;
  if (base.endsWith('.map')) return true;
  return false;
}

/** Extract the new-side path from a section's `diff --git a/<old> b/<new>` header. */
function pathFromHeader(section: string): string {
  const match = section.split('\n', 1)[0].match(FILE_HEADER_RE);
  return match ? match[1] : '';
}

/**
 * Split a unified diff into chunks of whole file sections, each at most
 * `targetChars` long, excluding noise files.
 *
 * Splitting only ever happens on `diff --git` boundaries, so a file's hunks
 * are never separated. A single file whose section exceeds `targetChars` still
 * gets its own chunk (it is never further divided). A diff that fits within
 * `targetChars` returns a single chunk, making small PRs a no-op passthrough.
 *
 * Each section is matched back to its PRFile by filename so callers can build
 * accurate per-chunk metadata; an unmatched section (no corresponding listFiles
 * entry) gets a minimal synthesized PRFile so it is still reviewed.
 */
export function splitDiffIntoChunks(diff: string, files: PRFile[], targetChars: number): ChunkPlan {
  const byName = new Map(files.map((f) => [f.filename, f]));

  // Split before each `diff --git ` that begins a line; the first section has
  // no leading newline so it survives the lookahead split intact. Any preamble
  // before the first header (there shouldn't be any) is dropped.
  const rawSections = diff
    .split(/\n(?=diff --git )/)
    .filter((s) => s.startsWith('diff --git '));

  // Safety net: a non-empty diff with no `diff --git` headers (an unexpected
  // format) is reviewed whole rather than silently dropped to zero chunks.
  if (rawSections.length === 0) {
    return diff.trim().length > 0 ? { chunks: [{ diff, files }], skipped: [] } : { chunks: [], skipped: [] };
  }

  const chunks: DiffChunk[] = [];
  const skipped: PRFile[] = [];

  for (const section of rawSections) {
    const path = pathFromHeader(section);
    const prFile =
      byName.get(path) ?? { filename: path, status: 'modified', additions: 0, deletions: 0, changes: 0 };

    if (isNoiseFile(path)) {
      skipped.push(prFile);
      continue;
    }

    // Append to the current chunk, or start a new one when this section would
    // overflow the target. A lone oversized file still ends up alone: it starts
    // a fresh chunk, then the next section overflows past it.
    const current = chunks[chunks.length - 1];
    if (current && current.diff.length + 1 + section.length <= targetChars) {
      current.diff += '\n' + section;
      current.files.push(prFile);
    } else {
      chunks.push({ diff: section, files: [prFile] });
    }
  }

  return { chunks, skipped };
}

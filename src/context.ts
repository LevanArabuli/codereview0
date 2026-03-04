import { dirname, join, extname, basename } from 'node:path';
import type { Octokit } from '@octokit/rest';
import type { PRFile, RelatedFile, ReviewContext } from './types.js';
import { fetchFileContent } from './github.js';

/** Maximum number of related files to fetch in quick mode */
const MAX_RELATED_FILES = 5;

/** Per-file character limit (skip files over this size) */
const MAX_FILE_SIZE = 50_000;

/** Total character budget for all related file content */
const MAX_TOTAL_SIZE = 200_000;

/** Code file extensions to consider for related file discovery */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** Priority order for deduplication: lower index = higher priority */
const REASON_PRIORITY: Record<string, number> = {
  import: 0,
  test: 1,
  type: 2,
  barrel: 3,
};

/**
 * Regex matching ES module imports and CommonJS require with relative paths.
 * Captures the path string (group 1). Only matches ./ and ../ prefixed paths.
 *
 * Matches:
 *   import { foo } from './bar'
 *   import foo from '../utils'
 *   import './setup'
 *   require('./helper')
 *
 * Does NOT match:
 *   import { Octokit } from '@octokit/rest'  (external package)
 *   import('${dynamicPath}')  (template literal)
 */
const RELATIVE_IMPORT_RE = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*)['"](\.[^'"]+)['"]/g;

/**
 * Extract relative import paths from TypeScript/JavaScript source.
 * Returns deduplicated list of import paths starting with ./ or ../
 */
export function extractRelativeImports(source: string): string[] {
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  // Reset lastIndex for safety (regex is global)
  RELATIVE_IMPORT_RE.lastIndex = 0;
  while ((m = RELATIVE_IMPORT_RE.exec(source)) !== null) {
    paths.push(m[1]);
  }
  return [...new Set(paths)];
}

/**
 * Resolve a relative import path to candidate file paths.
 * If the import already has an extension, returns it as-is.
 * Otherwise, generates candidates with CODE_EXTENSIONS and /index variants.
 */
export function resolveImportPath(importingFile: string, importPath: string): string[] {
  const dir = dirname(importingFile);
  const resolved = join(dir, importPath);

  // Normalize: remove leading ./ for consistency
  const normalized = resolved.startsWith('./') ? resolved.slice(2) : resolved;

  // If already has a known code extension, return as-is
  const ext = extname(normalized);
  if (ext && CODE_EXTENSIONS.includes(ext)) {
    return [normalized];
  }

  // Generate candidates: try extensions, then /index + extensions
  const candidates: string[] = [];
  for (const ext of CODE_EXTENSIONS) {
    candidates.push(normalized + ext);
  }
  for (const ext of CODE_EXTENSIONS) {
    candidates.push(join(normalized, 'index' + ext));
  }
  return candidates;
}

/**
 * Infer related files by naming patterns for a given source file.
 * Generates test file candidates (foo.test.ts, foo.spec.ts) in same dir
 * and tests/ directory, plus barrel file (index.ts) in same dir.
 */
export function inferRelatedByNaming(
  filePath: string,
): { path: string; reason: 'test' | 'barrel' }[] {
  const related: { path: string; reason: 'test' | 'barrel' }[] = [];
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const base = basename(filePath, ext);

  // Skip if not a code file
  if (!CODE_EXTENSIONS.includes(ext)) {
    return related;
  }

  // Test files in same directory: foo.test.ts, foo.spec.ts
  for (const suffix of ['.test', '.spec']) {
    related.push({ path: join(dir, base + suffix + ext), reason: 'test' });
  }

  // Test files in tests/ directory for src/ files
  // e.g., src/github.ts -> tests/github.test.ts
  if (filePath.startsWith('src/')) {
    const testsDir = dirname(filePath).replace(/^src/, 'tests');
    for (const suffix of ['.test', '.spec']) {
      related.push({ path: join(testsDir, base + suffix + ext), reason: 'test' });
    }
  }

  // Barrel file in the same directory
  related.push({ path: join(dir, 'index' + ext), reason: 'barrel' });

  return related;
}

/**
 * Discover related files for a set of changed files.
 * Combines import parsing and naming pattern inference.
 * Excludes files already in the diff. Deduplicates by path,
 * keeping the higher-priority reason (import > test > type > barrel).
 * Results sorted by priority: imports first, then tests, then types, then barrels.
 */
export function discoverRelatedFiles(
  changedFiles: PRFile[],
  changedFileContents: Map<string, string>,
): { path: string; reason: 'import' | 'test' | 'type' | 'barrel' }[] {
  const changedPaths = new Set(changedFiles.map(f => f.filename));
  // Map of path -> reason (keeps highest priority reason)
  const discovered = new Map<string, 'import' | 'test' | 'type' | 'barrel'>();

  function addCandidate(path: string, reason: 'import' | 'test' | 'type' | 'barrel'): void {
    // Skip files already in the diff
    if (changedPaths.has(path)) return;

    // Skip non-code files
    const ext = extname(path);
    if (!CODE_EXTENSIONS.includes(ext)) return;

    const existing = discovered.get(path);
    if (!existing || REASON_PRIORITY[reason] < REASON_PRIORITY[existing]) {
      discovered.set(path, reason);
    }
  }

  for (const file of changedFiles) {
    const content = changedFileContents.get(file.filename);

    // Import parsing: extract imports and resolve to candidates
    if (content) {
      const imports = extractRelativeImports(content);
      for (const importPath of imports) {
        const candidates = resolveImportPath(file.filename, importPath);
        for (const candidate of candidates) {
          addCandidate(candidate, 'import');
        }
      }
    }

    // Naming pattern inference: test files, barrel files
    const namingRelated = inferRelatedByNaming(file.filename);
    for (const nr of namingRelated) {
      addCandidate(nr.path, nr.reason);
    }
  }

  // Convert to array and sort by priority
  const result = Array.from(discovered.entries()).map(([path, reason]) => ({ path, reason }));
  result.sort((a, b) => REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason]);

  return result;
}

/**
 * Gather quick-mode context: discover related files, fetch their content,
 * enforce budget limits.
 *
 * Returns ReviewContext with relatedFiles (empty array if nothing found, never throws).
 */
export async function gatherQuickContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  changedFiles: PRFile[],
  changedFileContents: Map<string, string>,
): Promise<ReviewContext> {
  const candidates = discoverRelatedFiles(changedFiles, changedFileContents);
  const top = candidates.slice(0, MAX_RELATED_FILES);

  if (top.length === 0) {
    return { relatedFiles: [] };
  }

  // Fetch in parallel
  const results = await Promise.allSettled(
    top.map(c => fetchFileContent(octokit, owner, repo, c.path, ref)),
  );

  const relatedFiles: RelatedFile[] = [];
  let totalSize = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status !== 'fulfilled' || !result.value) continue;

    const content = result.value;

    // Skip oversized files
    if (content.length > MAX_FILE_SIZE) continue;

    // Check total budget
    if (totalSize + content.length > MAX_TOTAL_SIZE) continue;

    totalSize += content.length;
    relatedFiles.push({
      path: top[i].path,
      content,
      reason: top[i].reason,
    });
  }

  return { relatedFiles };
}

/**
 * Build deep-mode exploration guidance: for each changed file,
 * provide structured categories of related files to explore.
 * Claude finds the actual files itself (has full repo access).
 */
export function buildExplorationGuidance(changedFiles: PRFile[]): ReviewContext {
  const explorationGuidance = changedFiles.map(file => ({
    file: file.filename,
    categories: ['callers', 'tests', 'type-definitions'],
  }));

  return { explorationGuidance };
}

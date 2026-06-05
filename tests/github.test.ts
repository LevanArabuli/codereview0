import { describe, it, expect } from 'vitest';
import { fetchPRData } from '../src/github.js';
import { parseDiffHunks } from '../src/diff-parser.js';
import { parseDetailedDiff } from '../src/html-diff-parser.js';
import type { Octokit } from '@octokit/rest';

/** A raw listFiles entry, mirroring the fields the GitHub API returns. */
interface RawFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

/**
 * Mock Octokit driven by an explicit file list. `listFiles` paginates 100 per
 * page (respecting `page`), and the diff blob `get` can be made to throw a
 * configurable error to exercise the too_large fallback.
 */
function createMockOctokitWith(opts: {
  files: RawFile[];
  diff?: string;
  diffError?: { status?: number; message?: string };
  changedFiles?: number;
}) {
  const prData = {
    number: 42,
    title: 'Large PR',
    body: 'desc',
    user: { login: 'author' },
    base: { ref: 'main' },
    head: { ref: 'feature', sha: 'sha123', repo: { owner: { login: 'owner' }, name: 'repo' } },
    additions: 100,
    deletions: 20,
    changed_files: opts.changedFiles ?? opts.files.length,
  };
  const PER_PAGE = 100;

  return {
    pulls: {
      get: async ({ mediaType }: { mediaType?: { format: string } }) => {
        if (mediaType?.format === 'diff') {
          if (opts.diffError) {
            const err = new Error(opts.diffError.message ?? 'too_large') as Error & { status?: number };
            err.status = opts.diffError.status;
            throw err;
          }
          return { data: opts.diff ?? '' };
        }
        return { data: prData };
      },
      listFiles: async ({ page = 1 }: { page?: number }) => {
        const start = (page - 1) * PER_PAGE;
        return { data: opts.files.slice(start, start + PER_PAGE) };
      },
    },
  } as unknown as Octokit;
}

function createMockOctokit(overrides?: {
  body?: string | null;
  user?: { login: string } | null;
}) {
  const prData = {
    number: 42,
    title: 'Add feature X',
    body: overrides?.body !== undefined ? overrides.body : 'PR description',
    user: overrides?.user !== undefined ? overrides.user : { login: 'testauthor' },
    base: { ref: 'main' },
    head: { ref: 'feature-x', sha: 'abc123def456' },
    additions: 50,
    deletions: 10,
    changed_files: 3,
  };

  const filesData = [
    { filename: 'src/foo.ts', status: 'modified', additions: 30, deletions: 5, changes: 35 },
    { filename: 'src/bar.ts', status: 'added', additions: 15, deletions: 0, changes: 15 },
    { filename: 'src/baz.ts', status: 'modified', additions: 5, deletions: 5, changes: 10 },
  ];

  return {
    pulls: {
      get: async ({ mediaType }: { owner: string; repo: string; pull_number: number; mediaType?: { format: string } }) => {
        if (mediaType?.format === 'diff') {
          return { data: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,5 @@\n+new line' };
        }
        return { data: prData };
      },
      listFiles: async () => ({ data: filesData }),
    },
  } as unknown as Octokit;
}

describe('fetchPRData', () => {
  it('returns correctly shaped PRData', async () => {
    const octokit = createMockOctokit();
    const result = await fetchPRData(octokit, 'owner', 'repo', 42);

    expect(result.number).toBe(42);
    expect(result.title).toBe('Add feature X');
    expect(result.body).toBe('PR description');
    expect(result.author).toBe('testauthor');
    expect(result.baseBranch).toBe('main');
    expect(result.headBranch).toBe('feature-x');
    expect(result.headSha).toBe('abc123def456');
    expect(result.additions).toBe(50);
    expect(result.deletions).toBe(10);
    expect(result.changedFiles).toBe(3);
    expect(result.files).toHaveLength(3);
    expect(result.diff).toContain('--- a/src/foo.ts');
  });

  it('maps file data correctly', async () => {
    const octokit = createMockOctokit();
    const result = await fetchPRData(octokit, 'owner', 'repo', 42);

    expect(result.files[0]).toEqual({
      filename: 'src/foo.ts',
      status: 'modified',
      additions: 30,
      deletions: 5,
      changes: 35,
    });
    expect(result.files[1].status).toBe('added');
  });

  it('defaults body to empty string when null', async () => {
    const octokit = createMockOctokit({ body: null });
    const result = await fetchPRData(octokit, 'owner', 'repo', 42);

    expect(result.body).toBe('');
  });

  it('defaults author to unknown when user is null', async () => {
    const octokit = createMockOctokit({ user: null });
    const result = await fetchPRData(octokit, 'owner', 'repo', 42);

    expect(result.author).toBe('unknown');
  });
});

describe('fetchPRData with large PRs', () => {
  it('paginates listFiles so PRs with more than 100 files are not truncated', async () => {
    const files: RawFile[] = Array.from({ length: 250 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      status: 'modified',
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: '@@ -1,1 +1,2 @@\n context\n+added',
    }));
    const octokit = createMockOctokitWith({ files, diff: 'blob diff' });

    const result = await fetchPRData(octokit, 'owner', 'repo', 42);

    expect(result.files).toHaveLength(250);
  });

  it('reconstructs the diff from file patches when the blob diff is too_large', async () => {
    const files: RawFile[] = [
      {
        filename: 'src/foo.ts',
        status: 'modified',
        additions: 2,
        deletions: 0,
        changes: 2,
        patch: '@@ -1,3 +1,5 @@\n context\n+added line',
      },
    ];
    const octokit = createMockOctokitWith({
      files,
      diffError: { status: 406, message: 'diff exceeded the maximum number of lines (20000): too_large' },
    });

    const result = await fetchPRData(octokit, 'owner', 'repo', 42);

    expect(result.diff).toContain('diff --git a/src/foo.ts b/src/foo.ts');
    expect(result.diff).toContain('@@ -1,3 +1,5 @@');
    expect(result.diff).toContain('+added line');
    // The reconstructed diff must be parseable for inline-comment validation.
    expect(parseDiffHunks(result.diff).get('src/foo.ts')).toBeDefined();
  });

  it('synthesizes status-accurate headers so added/removed/renamed files classify correctly', async () => {
    const files: RawFile[] = [
      { filename: 'new.ts', status: 'added', additions: 1, deletions: 0, changes: 1, patch: '@@ -0,0 +1,1 @@\n+a' },
      { filename: 'gone.ts', status: 'removed', additions: 0, deletions: 1, changes: 1, patch: '@@ -1,1 +0,0 @@\n-a' },
      {
        filename: 'after.ts',
        status: 'renamed',
        previous_filename: 'before.ts',
        additions: 1,
        deletions: 0,
        changes: 1,
        patch: '@@ -1,1 +1,2 @@\n x\n+y',
      },
    ];
    const octokit = createMockOctokitWith({ files, diffError: { status: 406, message: 'too_large' } });

    const result = await fetchPRData(octokit, 'owner', 'repo', 42);
    const parsed = parseDetailedDiff(result.diff);

    expect(parsed.find((f) => f.filename === 'new.ts')?.status).toBe('added');
    expect(parsed.find((f) => f.filename === 'gone.ts')?.status).toBe('deleted');
    const renamed = parsed.find((f) => f.filename === 'after.ts');
    expect(renamed?.status).toBe('renamed');
    expect(renamed?.oldFilename).toBe('before.ts');
  });

  it('keeps files whose patch GitHub omitted without breaking hunk parsing', async () => {
    const files: RawFile[] = [
      { filename: 'big.bin', status: 'modified', additions: 0, deletions: 0, changes: 0 },
      { filename: 'ok.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '@@ -1,1 +1,2 @@\n x\n+y' },
    ];
    const octokit = createMockOctokitWith({ files, diffError: { status: 406, message: 'too_large' } });

    const result = await fetchPRData(octokit, 'owner', 'repo', 42);

    expect(result.diff).toContain('diff --git a/big.bin b/big.bin');
    expect(parseDiffHunks(result.diff).get('ok.ts')).toBeDefined();
  });

  it('propagates diff errors that are not too_large', async () => {
    const files: RawFile[] = [
      { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '@@ -1,1 +1,1 @@\n-a\n+b' },
    ];
    const octokit = createMockOctokitWith({ files, diffError: { status: 500, message: 'internal server error' } });

    await expect(fetchPRData(octokit, 'owner', 'repo', 42)).rejects.toThrow();
  });
});

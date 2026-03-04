import { describe, it, expect } from 'vitest';
import { fetchPRData, fetchFileContent } from '../src/github.js';
import type { Octokit } from '@octokit/rest';

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

function createMockOctokitForContent(
  response?: { data: unknown },
  shouldThrow?: boolean,
) {
  return {
    repos: {
      getContent: async (params: { owner: string; repo: string; path: string; ref?: string }) => {
        if (shouldThrow) {
          const err = new Error('Not Found') as Error & { status: number };
          err.status = 404;
          throw err;
        }
        // Store params so tests can inspect them
        (createMockOctokitForContent as unknown as { lastParams: unknown }).lastParams = params;
        return response;
      },
    },
  } as unknown as Octokit;
}

describe('fetchFileContent', () => {
  it('returns decoded string content for a valid file path', async () => {
    const content = Buffer.from('export const foo = 42;', 'utf-8').toString('base64');
    const octokit = createMockOctokitForContent({
      data: { type: 'file', content, encoding: 'base64', size: 22 },
    });

    const result = await fetchFileContent(octokit, 'owner', 'repo', 'src/foo.ts', 'abc123');
    expect(result).toBe('export const foo = 42;');
  });

  it('returns null when Octokit responds with a directory (Array response)', async () => {
    const octokit = createMockOctokitForContent({
      data: [
        { name: 'file1.ts', type: 'file' },
        { name: 'file2.ts', type: 'file' },
      ],
    });

    const result = await fetchFileContent(octokit, 'owner', 'repo', 'src/', 'abc123');
    expect(result).toBeNull();
  });

  it('returns null when data.type is not file', async () => {
    const octokit = createMockOctokitForContent({
      data: { type: 'symlink', target: 'other.ts' },
    });

    const result = await fetchFileContent(octokit, 'owner', 'repo', 'src/link.ts', 'abc123');
    expect(result).toBeNull();
  });

  it('returns null on 404 error (does not throw)', async () => {
    const octokit = createMockOctokitForContent(undefined, true);

    const result = await fetchFileContent(octokit, 'owner', 'repo', 'nonexistent.ts', 'abc123');
    expect(result).toBeNull();
  });

  it('passes ref parameter to Octokit for branch-specific fetch', async () => {
    const content = Buffer.from('hello', 'utf-8').toString('base64');
    const octokit = createMockOctokitForContent({
      data: { type: 'file', content, encoding: 'base64', size: 5 },
    });

    await fetchFileContent(octokit, 'myowner', 'myrepo', 'src/file.ts', 'sha-ref-123');
    const params = (createMockOctokitForContent as unknown as { lastParams: { owner: string; repo: string; path: string; ref: string } }).lastParams;
    expect(params.owner).toBe('myowner');
    expect(params.repo).toBe('myrepo');
    expect(params.path).toBe('src/file.ts');
    expect(params.ref).toBe('sha-ref-123');
  });
});

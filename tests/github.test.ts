import { describe, it, expect } from 'vitest';
import { fetchPRData } from '../src/github.js';
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

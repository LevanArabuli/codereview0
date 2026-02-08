import { execFileSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import type { PRData, PRFile } from './types.js';

/**
 * Get a GitHub auth token from the gh CLI.
 * Requires gh to be installed and authenticated.
 */
export function getGitHubToken(): string {
  const token = execFileSync('gh', ['auth', 'token'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  if (!token) {
    throw new Error('gh auth token returned empty string');
  }

  return token;
}

/**
 * Create an authenticated Octokit instance using the gh CLI token.
 */
export function createOctokit(): Octokit {
  const token = getGitHubToken();
  return new Octokit({ auth: token });
}

/**
 * Fetch complete PR data including metadata, file list, and unified diff.
 */
export async function fetchPRData(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PRData> {
  const [prResponse, filesResponse, diffResponse] = await Promise.all([
    octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    }),
    octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    }),
    octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    }) as unknown as { data: string },
  ]);

  const pr = prResponse.data;

  const files: PRFile[] = filesResponse.data.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
  }));

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    author: pr.user?.login ?? 'unknown',
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    files,
    diff: diffResponse.data,
  };
}

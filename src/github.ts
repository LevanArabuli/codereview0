import { execFileSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import type { PRData, PRFile } from './types.js';

/**
 * Get a GitHub auth token from the gh CLI.
 * Requires gh to be installed and authenticated.
 */
function getGitHubToken(): string {
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
    headRepoOwner: pr.head.repo?.owner?.login ?? owner,
    headRepoName: pr.head.repo?.name ?? repo,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    files,
    diff: diffResponse.data,
  };
}

/**
 * Post a code review to a GitHub pull request.
 *
 * Creates a PENDING review by omitting the `event` parameter entirely.
 * The user manually submits the review through the GitHub UI.
 *
 * If a 422 error occurs (invalid comment positions), falls back to posting
 * all findings in the review body with no inline comments.
 *
 * @returns The review HTML URL
 */
export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  body: string,
  comments: Array<{ path: string; line: number; side: string; body: string }>,
): Promise<string> {
  try {
    // PENDING state: achieved by OMITTING `event` (not by passing "PENDING")
    // Valid event values are APPROVE, REQUEST_CHANGES, COMMENT, DISMISS.
    // Omitting event entirely creates a pending/draft review.
    const response = await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: headSha,
      body,
      comments,
    });

    return response.data.html_url;
  } catch (error: unknown) {
    // 422 fallback: if inline comments target invalid positions,
    // promote all findings to the body and retry without comments
    const status = (error as { status?: number }).status;
    if (status === 422 && comments.length > 0) {
      // Build fallback body: original body + inline comments as text
      let fallbackBody = body;
      fallbackBody += '\n\n---\n\n**Inline comments could not be posted** (promoted to review body):\n';
      for (const c of comments) {
        fallbackBody += `\n**\`${c.path}:${c.line}\`**\n${c.body}\n`;
      }

      const response = await octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: headSha,
        body: fallbackBody,
        comments: [],
      });

      return response.data.html_url;
    }

    throw error;
  }
}

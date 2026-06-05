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

/** listFiles returns at most 100 files per page, capped at 3000 files (30 pages) total. */
const FILES_PER_PAGE = 100;
const MAX_FILE_PAGES = 30;

/** Raw listFiles entry fields needed for diff reconstruction. */
interface RawPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

/**
 * Fetch every changed file in a PR, following pagination.
 *
 * A single listFiles call returns at most 100 files; without this loop, PRs
 * with more than 100 changed files are silently truncated. GitHub caps the
 * endpoint at 3000 files (30 pages); beyond that the remainder is unavailable
 * from this API (the caller detects the shortfall via PR.changed_files).
 */
async function fetchAllFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<RawPRFile[]> {
  const all: RawPRFile[] = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const response = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: FILES_PER_PAGE,
      page,
    });
    const batch = response.data as RawPRFile[];
    all.push(...batch);
    if (batch.length < FILES_PER_PAGE) {
      break;
    }
  }
  return all;
}

/**
 * Detect GitHub's "diff too large" rejection. The single-blob diff endpoint
 * refuses diffs over 20,000 lines with HTTP 406 and a `too_large` code.
 */
function isDiffTooLargeError(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  const message = (error as { message?: string }).message ?? '';
  return status === 406 || message.includes('too_large');
}

/**
 * Reconstruct a unified diff from the per-file patches returned by listFiles.
 *
 * Used as a fallback when the single-blob diff exceeds GitHub's size limit.
 * Each file's `patch` carries the @@ hunks but not the `diff --git`/`---`/`+++`
 * headers, so they are synthesized here. Headers reflect the file's status so
 * downstream parsers (diff-parser, html-diff-parser) classify added/removed/
 * renamed files correctly. Files whose patch GitHub omitted (binary or oversized)
 * are kept with a visible note rather than silently dropped.
 */
function reconstructDiffFromFiles(files: RawPRFile[]): string {
  const parts: string[] = [];

  for (const file of files) {
    const newPath = file.filename;
    const oldPath = file.previous_filename ?? file.filename;
    parts.push(`diff --git a/${oldPath} b/${newPath}`);

    if (file.status === 'renamed') {
      parts.push(`rename from ${oldPath}`);
      parts.push(`rename to ${newPath}`);
    }

    if (file.patch !== undefined) {
      if (file.status === 'added') {
        parts.push('--- /dev/null', `+++ b/${newPath}`);
      } else if (file.status === 'removed') {
        parts.push(`--- a/${oldPath}`, '+++ /dev/null');
      } else {
        parts.push(`--- a/${oldPath}`, `+++ b/${newPath}`);
      }
      parts.push(file.patch);
    } else if (file.status !== 'renamed' && file.status !== 'copied' && file.status !== 'unchanged') {
      // GitHub omits the patch for binary or oversized files. Keep the file
      // visible (without fabricating a hunk) so the omission is explicit.
      parts.push(`--- a/${oldPath}`, `+++ b/${newPath}`);
      parts.push('[patch unavailable from GitHub API: binary file or exceeds per-file diff limit]');
    }
  }

  return parts.length > 0 ? parts.join('\n') + '\n' : '';
}

/**
 * Fetch complete PR data including metadata, file list, and unified diff.
 *
 * Metadata, the paginated file list, and the diff are fetched concurrently.
 * The diff blob is requested separately so that GitHub's too_large rejection
 * (diffs over 20,000 lines) falls back to reconstructing the diff from the
 * file patches instead of failing the whole request. Other diff errors still
 * propagate.
 */
export async function fetchPRData(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PRData> {
  const metadataP = octokit.pulls.get({ owner, repo, pull_number: prNumber });
  const filesP = fetchAllFiles(octokit, owner, repo, prNumber);
  const diffP = (
    octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    }) as unknown as Promise<{ data: string }>
  )
    .then((response) => ({ ok: true as const, diff: response.data }))
    .catch((error: unknown) => {
      if (isDiffTooLargeError(error)) {
        return { ok: false as const };
      }
      throw error;
    });

  const [prResponse, rawFiles, diffResult] = await Promise.all([metadataP, filesP, diffP]);

  const pr = prResponse.data;

  const files: PRFile[] = rawFiles.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
  }));

  const diff = diffResult.ok ? diffResult.diff : reconstructDiffFromFiles(rawFiles);

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
    diff,
  };
}

/**
 * Post a code review to a GitHub pull request.
 *
 * Defaults to a PENDING review by omitting the `event` parameter -- the user
 * manually submits the review through the GitHub UI. Pass `event: 'COMMENT'`
 * to submit immediately (visible to all PR participants, no approve/reject
 * verdict). APPROVE, REQUEST_CHANGES, and DISMISS are deliberately disallowed
 * by the type signature.
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
  event?: 'COMMENT',
): Promise<string> {
  // Build params once. `event` is only included when truthy so PENDING (the
  // default) still results in OMITTING the field entirely -- passing
  // `event: undefined` is rejected by the API.
  const params: Parameters<typeof octokit.pulls.createReview>[0] = {
    owner,
    repo,
    pull_number: prNumber,
    commit_id: headSha,
    body,
    comments,
  };
  if (event) {
    params.event = event;
  }

  try {
    const response = await octokit.pulls.createReview(params);
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
        ...params,
        body: fallbackBody,
        comments: [],
      });

      return response.data.html_url;
    }

    throw error;
  }
}

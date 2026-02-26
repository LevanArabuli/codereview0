import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

/** Clone timeout: 5 minutes (accommodates large enterprise repos with --depth 1) */
const CLONE_TIMEOUT_MS = 300_000;

/**
 * Validate a value from GitHub API is safe for use as a subprocess argument.
 * Rejects values with dangerous patterns: leading dash (git flag injection),
 * path traversal (..), null bytes.
 * Does NOT restrict valid GitHub characters (dots, slashes, hyphens allowed).
 */
export function validateGitArg(value: string, label: string): void {
  if (!value) {
    throw new Error(`Error: ${label} is empty. Aborting review.`);
  }
  if (value.startsWith('-')) {
    throw new Error(
      `Error: ${label} '${value}' starts with a dash -- contains dangerous characters. Aborting review.`,
    );
  }
  if (value.includes('..')) {
    throw new Error(
      `Error: ${label} '${value}' contains path traversal sequence. Aborting review.`,
    );
  }
  if (value.includes('\0')) {
    throw new Error(
      `Error: ${label} contains null byte. Aborting review.`,
    );
  }
}

/**
 * Get the local clone path for a repository.
 * Clones go into `.codereview/<repoName>` under the current working directory.
 *
 * Validates the repo name for filesystem safety and ensures the resolved
 * path stays within the `.codereview/` base directory (path traversal prevention).
 */
export function getClonePath(repoName: string): string {
  // Validate repo name for filesystem safety -- repo names are used as directory names.
  // Slashes, backslashes, and path traversal sequences are not valid in GitHub repo names
  // (only branch names can have slashes).
  if (!repoName || repoName.includes('/') || repoName.includes('\\') || repoName.includes('..')) {
    throw new Error(
      `Error: Repository name '${repoName}' contains unsafe path characters. Aborting review.`,
    );
  }

  const base = path.resolve(process.cwd(), '.codereview');
  const resolved = path.resolve(base, repoName);

  // Boundary check: resolved path must be a direct child of the base directory
  if (!resolved.startsWith(base + path.sep)) {
    throw new Error('Error: Clone path escapes base directory. Aborting review.');
  }

  return resolved;
}

/**
 * Shallow-clone a repository using `gh repo clone` for automatic authentication.
 *
 * Clones the specific PR head branch at depth 1 (single-branch).
 * If the target directory already exists, it is removed before cloning.
 *
 * For fork PRs, headRepoOwner/headRepoName will differ from the base repo,
 * ensuring we clone the fork (where the PR branch lives).
 */
export async function cloneRepo(
  headRepoOwner: string,
  headRepoName: string,
  headBranch: string,
  targetDir: string,
): Promise<void> {
  // Validate all GitHub API inputs before any subprocess call
  validateGitArg(headRepoOwner, 'Repository owner');
  validateGitArg(headRepoName, 'Repository name');
  validateGitArg(headBranch, 'Branch name');

  // Remove existing clone directory if present
  try {
    await access(targetDir);
    await rm(targetDir, { recursive: true, force: true });
  } catch {
    // Directory doesn't exist -- nothing to remove
  }

  // Create clone directory with restrictive permissions (owner-only access).
  // recursive: true also creates the .codereview/ parent if needed.
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  const p = execFile(
    'gh',
    [
      'repo', 'clone',
      `${headRepoOwner}/${headRepoName}`,
      targetDir,
      '--',
      '--depth', '1',
      '--branch', headBranch,
      '--single-branch',
    ],
    { timeout: CLONE_TIMEOUT_MS },
  );

  // Prevent stdin hang (established pattern from analyzer.ts)
  p.child.stdin?.end();

  await p;

  // Structural push prevention: remove git remote so Claude has nowhere to push
  // even if it tries. Non-fatal since this is defense-in-depth.
  try {
    execFileSync('git', ['remote', 'remove', 'origin'], { cwd: targetDir });
  } catch { /* non-fatal: defense-in-depth */ }
}

/**
 * Prompt the user to keep or delete the cloned repository after review.
 * Defaults to removing the clone (N) if the user presses enter or types anything other than 'y'.
 */
export async function promptCleanup(clonePath: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(`\nKeep cloned repo at ${clonePath}? (y/N) `);

    if (answer.trim().toLowerCase() === 'y') {
      console.log('Clone kept.');
    } else {
      await rm(clonePath, { recursive: true, force: true });
      console.log('Clone removed.');
    }
  } finally {
    rl.close();
  }
}

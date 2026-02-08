import { execFileSync } from 'node:child_process';
import type { PrereqFailure } from './types.js';

/**
 * Check all prerequisites and collect failures.
 *
 * Checks in order: gh CLI existence, gh auth status, claude CLI existence.
 * All failures are collected and returned at once (not fail-fast).
 * Returns an empty array when all checks pass (silent on success).
 */
export function checkPrerequisites(): PrereqFailure[] {
  const failures: PrereqFailure[] = [];
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';

  // 1. Check gh CLI exists
  let ghExists = false;
  try {
    execFileSync(whichCmd, ['gh'], { stdio: 'pipe' });
    ghExists = true;
  } catch {
    failures.push({
      name: 'gh',
      message: 'gh CLI not found',
      help: 'Install it: https://cli.github.com',
    });
  }

  // 2. If gh exists, check authentication
  if (ghExists) {
    try {
      execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' });
    } catch {
      failures.push({
        name: 'gh-auth',
        message: 'gh CLI is not authenticated',
        help: 'Run: gh auth login',
      });
    }
  }

  // 3. Check claude CLI exists
  try {
    execFileSync(whichCmd, ['claude'], { stdio: 'pipe' });
  } catch {
    failures.push({
      name: 'claude',
      message: 'claude CLI not found',
      help: 'Install it: https://docs.anthropic.com/en/docs/claude-code',
    });
  }

  return failures;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { checkPrerequisites } from '../src/prerequisites.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  mockedExecFileSync.mockReset();
});

describe('checkPrerequisites', () => {
  it('returns empty array when all prerequisites pass', () => {
    // All calls succeed (no throws)
    mockedExecFileSync.mockReturnValue(Buffer.from(''));

    const failures = checkPrerequisites();
    expect(failures).toEqual([]);
  });

  it('reports gh missing when which gh fails', () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'gh') throw new Error('not found');
      return Buffer.from('');
    });

    const failures = checkPrerequisites();
    expect(failures).toContainEqual(
      expect.objectContaining({ name: 'gh', message: 'gh CLI not found' })
    );
  });

  it('does not check gh auth when gh is missing', () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'gh') throw new Error('not found');
      return Buffer.from('');
    });

    const failures = checkPrerequisites();
    // Should not have gh-auth failure since gh itself was missing
    expect(failures.find((f) => f.name === 'gh-auth')).toBeUndefined();
  });

  it('reports gh-auth failure when gh exists but auth fails', () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const argsArr = args as string[];
      // which gh succeeds
      if (cmd === 'which' && argsArr[0] === 'gh') return Buffer.from('/usr/bin/gh');
      // gh auth status fails
      if (cmd === 'gh' && argsArr[0] === 'auth') throw new Error('not authenticated');
      // which claude succeeds
      return Buffer.from('');
    });

    const failures = checkPrerequisites();
    expect(failures).toContainEqual(
      expect.objectContaining({
        name: 'gh-auth',
        message: 'gh CLI is not authenticated',
      })
    );
  });

  it('reports claude missing when which claude fails', () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const argsArr = args as string[];
      if (argsArr[0] === 'claude') throw new Error('not found');
      return Buffer.from('');
    });

    const failures = checkPrerequisites();
    expect(failures).toContainEqual(
      expect.objectContaining({
        name: 'claude',
        message: 'claude CLI not found',
      })
    );
  });

  it('collects both gh and claude failures (not fail-fast)', () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      // Both which gh and which claude fail
      if (argsArr[0] === 'gh' || argsArr[0] === 'claude') {
        throw new Error('not found');
      }
      return Buffer.from('');
    });

    const failures = checkPrerequisites();
    expect(failures).toHaveLength(2);
    expect(failures[0].name).toBe('gh');
    expect(failures[1].name).toBe('claude');
  });

  it('collects gh-auth and claude failures together', () => {
    mockedExecFileSync.mockImplementation((cmd, args) => {
      const argsArr = args as string[];
      // which gh succeeds
      if (cmd === 'which' && argsArr[0] === 'gh') return Buffer.from('/usr/bin/gh');
      // gh auth status fails
      if (cmd === 'gh' && argsArr[0] === 'auth') throw new Error('not authenticated');
      // which claude fails
      if (cmd === 'which' && argsArr[0] === 'claude') throw new Error('not found');
      return Buffer.from('');
    });

    const failures = checkPrerequisites();
    expect(failures).toHaveLength(2);
    expect(failures[0].name).toBe('gh-auth');
    expect(failures[1].name).toBe('claude');
  });

  it('includes actionable help text in each failure', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const failures = checkPrerequisites();
    const ghFailure = failures.find((f) => f.name === 'gh');
    const claudeFailure = failures.find((f) => f.name === 'claude');

    expect(ghFailure?.help).toContain('https://cli.github.com');
    expect(claudeFailure?.help).toContain('https://docs.anthropic.com');
  });
});

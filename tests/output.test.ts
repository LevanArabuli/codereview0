import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printPRSummary, printErrors, printVerbose } from '../src/output.js';
import type { PRData, PrereqFailure } from '../src/types.js';

const mockPR: PRData = {
  number: 42,
  title: 'Add feature X',
  body: 'PR description',
  author: 'testauthor',
  baseBranch: 'main',
  headBranch: 'feature-x',
  headSha: 'abc123',
  additions: 50,
  deletions: 10,
  changedFiles: 2,
  files: [
    { filename: 'src/foo.ts', status: 'modified', additions: 30, deletions: 5, changes: 35 },
    { filename: 'src/bar.ts', status: 'added', additions: 20, deletions: 5, changes: 25 },
  ],
  diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,5 @@\n+new line',
};

describe('printPRSummary', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints the PR title', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Add feature X');
  });

  it('prints the PR number and author', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('#42');
    expect(output).toContain('testauthor');
  });

  it('prints branch names', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('feature-x');
    expect(output).toContain('main');
  });

  it('prints file stats in diff-stat style', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('src/foo.ts');
    expect(output).toContain('src/bar.ts');
  });

  it('prints completion message', () => {
    printPRSummary(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('PR data fetched successfully');
  });
});

describe('printErrors', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('prints each failure with X prefix', () => {
    const failures: PrereqFailure[] = [
      { name: 'gh', message: 'gh CLI not found', help: 'Install it: https://cli.github.com' },
    ];
    printErrors(failures);
    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('\u2716');
    expect(output).toContain('gh CLI not found');
  });

  it('prints actionable help text for each failure', () => {
    const failures: PrereqFailure[] = [
      { name: 'gh', message: 'gh CLI not found', help: 'Install it: https://cli.github.com' },
      { name: 'claude', message: 'claude CLI not found', help: 'Install it: https://docs.anthropic.com/en/docs/claude-code' },
    ];
    printErrors(failures);
    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('https://cli.github.com');
    expect(output).toContain('https://docs.anthropic.com');
  });

  it('prints multiple failures', () => {
    const failures: PrereqFailure[] = [
      { name: 'gh', message: 'gh CLI not found', help: 'Install it' },
      { name: 'claude', message: 'claude CLI not found', help: 'Install it' },
    ];
    printErrors(failures);
    // 2 failures * 2 lines each = 4 console.error calls
    expect(errorSpy).toHaveBeenCalledTimes(4);
  });
});

describe('printVerbose', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints the raw diff content', () => {
    printVerbose(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('--- a/src/foo.ts');
    expect(output).toContain('+new line');
  });

  it('prints diff length info', () => {
    printVerbose(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain(`${mockPR.diff.length} characters`);
  });

  it('prints section header', () => {
    printVerbose(mockPR);
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Raw Diff');
  });
});

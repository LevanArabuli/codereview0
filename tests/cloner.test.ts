import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process and node:util before importing cloner
const mockChild = { stdin: { end: vi.fn() } };
const mockExecFile = vi.fn();

// Make promisify return the mock directly so .child is accessible
vi.mock('node:util', () => ({
  promisify: () => mockExecFile,
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  rm: vi.fn().mockResolvedValue(undefined),
}));

function makePromiseWithChild() {
  return Object.assign(Promise.resolve({ stdout: '' }), { child: mockChild });
}

const { cloneRepo } = await import('../src/cloner.js');

describe('cloneRepo', () => {
  beforeEach(() => {
    mockExecFile.mockClear();
    mockChild.stdin.end.mockClear();
    mockExecFile.mockReturnValue(makePromiseWithChild());
  });

  it('passes 300_000ms timeout to execFile', async () => {
    await cloneRepo('owner', 'repo', 'feature-branch', '/tmp/target');

    expect(mockExecFile).toHaveBeenCalledOnce();
    const options = mockExecFile.mock.calls[0][2];
    expect(options).toEqual({ timeout: 300_000 });
  });

  it('calls gh repo clone with correct arguments', async () => {
    await cloneRepo('myorg', 'myrepo', 'my-branch', '/tmp/clone-dir');

    expect(mockExecFile).toHaveBeenCalledOnce();
    const [command, args] = mockExecFile.mock.calls[0];
    expect(command).toBe('gh');
    expect(args).toEqual([
      'repo', 'clone',
      'myorg/myrepo',
      '/tmp/clone-dir',
      '--',
      '--depth', '1',
      '--branch', 'my-branch',
      '--single-branch',
    ]);
  });

  it('ends stdin to prevent hang', async () => {
    await cloneRepo('owner', 'repo', 'branch', '/tmp/dir');

    expect(mockChild.stdin.end).toHaveBeenCalledOnce();
  });
});

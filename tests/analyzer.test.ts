import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PRData } from '../src/types.js';

// Mock child for stdin (prompt is written here, then ended)
const mockChild = { stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() } };
const mockExecFile = vi.fn();

// Make promisify return the mock directly so .child is accessible
vi.mock('node:util', () => ({
  promisify: () => mockExecFile,
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

const { analyzeDiff } = await import('../src/analyzer.js');

/** Minimal PRData for testing */
const mockPR: PRData = {
  number: 1,
  title: 'Test PR',
  body: '',
  author: 'tester',
  baseBranch: 'main',
  headBranch: 'feature',
  headSha: 'abc123',
  headRepoOwner: 'owner',
  headRepoName: 'repo',
  additions: 10,
  deletions: 5,
  changedFiles: 1,
  files: [{ filename: 'src/foo.ts', status: 'modified', additions: 10, deletions: 5, changes: 15 }],
  diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,5 @@\n+new line',
};

/** Build a mock Claude CLI wrapper response */
function buildWrapper(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.0423,
    is_error: false,
    duration_ms: 45200,
    duration_api_ms: 43100,
    num_turns: 5,
    result: JSON.stringify({ findings: [] }),
    session_id: 'test-session-123',
    modelUsage: { 'claude-sonnet-4-20250514': {} },
    ...overrides,
  };
}

function mockExecFileReturn(wrapper: Record<string, unknown>) {
  mockExecFile.mockReturnValue(
    Object.assign(Promise.resolve({ stdout: JSON.stringify(wrapper) }), { child: mockChild }),
  );
}

describe('analyzeDiff', () => {
  beforeEach(() => {
    mockExecFile.mockClear();
    mockChild.stdin.write.mockClear();
    mockChild.stdin.end.mockClear();
  });

  it('sends the prompt via stdin, not argv (a large diff in argv overflows ARG_MAX -> E2BIG)', async () => {
    mockExecFileReturn(buildWrapper());

    await analyzeDiff(mockPR);

    const [cmd, args] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('claude');
    // The prompt must NOT be an argv element -- that is what overflows ARG_MAX.
    const promptInArgv = args.some((a) => typeof a === 'string' && a.includes('reviewing a pull request'));
    expect(promptInArgv).toBe(false);
    // It must be written to the child's stdin and the stream closed.
    expect(mockChild.stdin.write).toHaveBeenCalledTimes(1);
    expect(mockChild.stdin.write.mock.calls[0][0]).toContain('reviewing a pull request');
    expect(mockChild.stdin.end).toHaveBeenCalled();
  });

  it('reads total_cost_usd from wrapper into meta.cost_usd', async () => {
    mockExecFileReturn(buildWrapper({ total_cost_usd: 0.0423 }));

    const result = await analyzeDiff(mockPR);

    expect(result.meta).toBeDefined();
    expect(result.meta!.cost_usd).toBe(0.0423);
  });

  it('falls back to cost_usd when total_cost_usd is absent', async () => {
    const wrapper = buildWrapper({ cost_usd: 0.015 });
    delete (wrapper as Record<string, unknown>).total_cost_usd;
    mockExecFileReturn(wrapper);

    const result = await analyzeDiff(mockPR);

    expect(result.meta).toBeDefined();
    expect(result.meta!.cost_usd).toBe(0.015);
  });

  it('defaults cost_usd to 0 when both fields are absent', async () => {
    const wrapper = buildWrapper();
    delete (wrapper as Record<string, unknown>).total_cost_usd;
    delete (wrapper as Record<string, unknown>).cost_usd;
    mockExecFileReturn(wrapper);

    const result = await analyzeDiff(mockPR);

    expect(result.meta).toBeDefined();
    expect(result.meta!.cost_usd).toBe(0);
  });

  it('returns meta with duration and turns', async () => {
    mockExecFileReturn(buildWrapper({ duration_ms: 45200, num_turns: 5 }));

    const result = await analyzeDiff(mockPR);

    expect(result.meta).toBeDefined();
    expect(result.meta!.duration_ms).toBe(45200);
    expect(result.meta!.num_turns).toBe(5);
  });

  it('returns meta with duration_api_ms and session_id', async () => {
    mockExecFileReturn(buildWrapper({ duration_api_ms: 43100, session_id: 'sess-abc' }));

    const result = await analyzeDiff(mockPR);

    expect(result.meta).toBeDefined();
    expect(result.meta!.duration_api_ms).toBe(43100);
    expect(result.meta!.session_id).toBe('sess-abc');
  });

  it('extracts model from modelUsage keys', async () => {
    mockExecFileReturn(buildWrapper({ modelUsage: { 'claude-opus-4-6': {} } }));

    const result = await analyzeDiff(mockPR);

    expect(result.model).toBe('claude-opus-4-6');
  });

  it('returns empty findings array when wrapper result has no findings', async () => {
    mockExecFileReturn(buildWrapper({ result: JSON.stringify({ findings: [] }) }));

    const result = await analyzeDiff(mockPR);

    expect(result.findings).toEqual([]);
  });

  it('parses findings from wrapper result', async () => {
    const findings = [{
      file: 'src/foo.ts',
      line: 10,
      severity: 'bug',
      confidence: 'high',
      category: 'logic',
      description: 'Missing null check',
    }];
    mockExecFileReturn(buildWrapper({ result: JSON.stringify({ findings }) }));

    const result = await analyzeDiff(mockPR);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].description).toBe('Missing null check');
  });
});

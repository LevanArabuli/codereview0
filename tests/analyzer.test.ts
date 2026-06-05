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

const { analyzeDiff, analyzeDiffChunked } = await import('../src/analyzer.js');

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

describe('analyzeDiffChunked', () => {
  function prFile(filename: string) {
    return { filename, status: 'modified', additions: 1, deletions: 0, changes: 1 };
  }

  /** One file's diff section, padded to `chars` so chunking boundaries are predictable. */
  function section(path: string, chars: number) {
    return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,2 @@\n context\n+${'x'.repeat(chars)}`;
  }

  function finding(file: string) {
    return {
      file,
      line: 1,
      severity: 'bug' as const,
      confidence: 'high' as const,
      category: 'logic',
      description: `issue in ${file}`,
    };
  }

  function metaWith(cost: number) {
    return { cost_usd: cost, duration_ms: 10, num_turns: 1, duration_api_ms: 5, session_id: 's' };
  }

  /** A PR whose diff (4 files x ~40k chars) splits into multiple ~100k-char chunks. */
  function chunkingPR(): PRData {
    const files = Array.from({ length: 4 }, (_, i) => prFile(`src/f${i}.ts`));
    const diff = files.map((f) => section(f.filename, 40_000)).join('\n') + '\n';
    return { ...mockPR, files, changedFiles: files.length, diff };
  }

  it('splits a large diff into multiple chunks and merges all findings', async () => {
    const prData = chunkingPR();
    const analyze = async (pr: PRData) => ({
      findings: pr.files.map((f) => finding(f.filename)),
      model: 'claude-opus-4-8',
      meta: metaWith(1),
    });

    const result = await analyzeDiffChunked(prData, undefined, undefined, analyze);

    expect(result.chunkCount).toBeGreaterThan(1);
    expect(result.findings).toHaveLength(4); // one per file, across all chunks
    expect(result.findings.map((f) => f.file).sort()).toEqual(
      ['src/f0.ts', 'src/f1.ts', 'src/f2.ts', 'src/f3.ts'],
    );
  });

  it('sums cost across chunks', async () => {
    const prData = chunkingPR();
    const analyze = async () => ({ findings: [], model: 'm', meta: metaWith(1.5) });

    const result = await analyzeDiffChunked(prData, undefined, undefined, analyze);

    expect(result.meta!.cost_usd).toBeCloseTo(1.5 * result.chunkCount);
  });

  it('tolerates a failing chunk and returns partial findings', async () => {
    const prData = chunkingPR();
    const analyze = async (pr: PRData) => {
      if (pr.files.some((f) => f.filename === 'src/f3.ts')) throw new Error('chunk boom');
      return { findings: pr.files.map((f) => finding(f.filename)), model: 'm', meta: metaWith(1) };
    };

    const result = await analyzeDiffChunked(prData, undefined, undefined, analyze);

    expect(result.failedChunks).toBe(1);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.map((f) => f.file)).not.toContain('src/f3.ts');
  });

  it('throws when every chunk fails', async () => {
    const prData = chunkingPR();
    const analyze = async () => {
      throw new Error('all boom');
    };

    await expect(analyzeDiffChunked(prData, undefined, undefined, analyze)).rejects.toThrow();
  });

  it('reports noise files as skipped and does not review them', async () => {
    const reviewed: string[] = [];
    const prData: PRData = {
      ...mockPR,
      files: [prFile('yarn.lock'), prFile('src/a.ts')],
      changedFiles: 2,
      diff: [section('yarn.lock', 100), section('src/a.ts', 100)].join('\n') + '\n',
    };
    const analyze = async (pr: PRData) => {
      reviewed.push(...pr.files.map((f) => f.filename));
      return { findings: [], model: 'm', meta: metaWith(1) };
    };

    const result = await analyzeDiffChunked(prData, undefined, undefined, analyze);

    expect(result.skippedFiles).toBe(1);
    expect(reviewed).toContain('src/a.ts');
    expect(reviewed).not.toContain('yarn.lock');
  });

  it('reviews a small diff as a single chunk', async () => {
    let calls = 0;
    const analyze = async () => {
      calls++;
      return { findings: [], model: 'm', meta: metaWith(1) };
    };

    const result = await analyzeDiffChunked(mockPR, undefined, undefined, analyze);

    expect(result.chunkCount).toBe(1);
    expect(calls).toBe(1);
  });
});

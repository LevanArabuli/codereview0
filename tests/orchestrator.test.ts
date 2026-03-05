import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewFinding } from '../src/schemas.js';
import type { AnalysisResult } from '../src/analyzer.js';
import type { PRData } from '../src/types.js';

// ---- Mocks for analyzer.ts ----
const mockAnalyzeDiff = vi.fn();
const mockAnalyzeAgentic = vi.fn();
const mockFilterEnv = vi.fn();

vi.mock('../src/analyzer.js', () => ({
  analyzeDiff: (...args: unknown[]) => mockAnalyzeDiff(...args),
  analyzeAgentic: (...args: unknown[]) => mockAnalyzeAgentic(...args),
  filterEnv: () => mockFilterEnv(),
}));

const {
  analyzeTeamQuick,
  analyzeTeamDeep,
  deduplicateFindings,
} = await import('../src/orchestrator.js');

// ---- Test helpers ----

/** Minimal PRData for testing */
const mockPR: PRData = {
  number: 42,
  title: 'Test PR',
  body: 'Test body',
  author: 'tester',
  baseBranch: 'main',
  headBranch: 'feature',
  headSha: 'abc123',
  headRepoOwner: 'owner',
  headRepoName: 'repo',
  additions: 10,
  deletions: 5,
  changedFiles: 2,
  files: [
    { filename: 'src/foo.ts', status: 'modified', additions: 10, deletions: 5, changes: 15 },
  ],
  diff: '+new line',
};

/** Create a mock AnalysisResult with configurable findings */
function mockResult(findings: ReviewFinding[] = [], model = 'claude-sonnet-4'): AnalysisResult {
  return { findings, model };
}

/** Create a mock ReviewFinding with defaults */
function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: 'src/foo.ts',
    line: 10,
    severity: 'suggestion',
    confidence: 'high',
    category: 'quality',
    description: 'Consider refactoring this function for clarity',
    ...overrides,
  };
}

// ---- Tests ----

describe('analyzeTeamQuick', () => {
  beforeEach(() => {
    mockAnalyzeDiff.mockReset();
    mockAnalyzeAgentic.mockReset();
    mockFilterEnv.mockReset();
  });

  it('calls analyzeDiff 4 times (once per aspect) concurrently', async () => {
    mockAnalyzeDiff.mockResolvedValue(mockResult());

    await analyzeTeamQuick(mockPR);

    expect(mockAnalyzeDiff).toHaveBeenCalledTimes(4);
    // Verify each call gets a different aspect
    const aspects = mockAnalyzeDiff.mock.calls.map((call: unknown[]) => call[3]);
    expect(aspects).toContain('security');
    expect(aspects).toContain('performance');
    expect(aspects).toContain('quality');
    expect(aspects).toContain('tests');
  });

  it('returns findings with aspect field stamped on each finding', async () => {
    mockAnalyzeDiff.mockImplementation(
      (_pr: PRData, _model: string | undefined, _mode: string | undefined, aspect: string) =>
        Promise.resolve(mockResult([makeFinding({ description: `Issue from ${aspect}` })]))
    );

    const result = await analyzeTeamQuick(mockPR);

    // Each finding should have the aspect field set
    for (const finding of result.findings) {
      expect(finding.aspect).toBeDefined();
      expect(['security', 'performance', 'quality', 'tests']).toContain(finding.aspect);
    }
  });

  it('passes model and mode arguments through to analyzeDiff', async () => {
    mockAnalyzeDiff.mockResolvedValue(mockResult());

    await analyzeTeamQuick(mockPR, 'claude-opus-4', 'strict');

    for (const call of mockAnalyzeDiff.mock.calls) {
      expect(call[1]).toBe('claude-opus-4');
      expect(call[2]).toBe('strict');
    }
  });

  it('handles partial failure: 1 of 4 fails, 3 succeed', async () => {
    mockAnalyzeDiff.mockImplementation(
      (_pr: PRData, _model: string | undefined, _mode: string | undefined, aspect: string) => {
        if (aspect === 'security') {
          return Promise.reject(new Error('Security agent crashed'));
        }
        return Promise.resolve(mockResult([makeFinding({ description: `From ${aspect}` })]));
      }
    );

    const result = await analyzeTeamQuick(mockPR);

    // Should have findings from the 3 successful aspects
    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    expect(result.allFailed).toBe(false);
    expect(result.aspectStatus.security).toBe('failed');
    expect(result.aspectStatus.performance).toBe('done');
    expect(result.aspectStatus.quality).toBe('done');
    expect(result.aspectStatus.tests).toBe('done');
  });

  it('returns allFailed=true when all 4 aspects fail', async () => {
    mockAnalyzeDiff.mockRejectedValue(new Error('All agents down'));

    const result = await analyzeTeamQuick(mockPR);

    expect(result.allFailed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.aspectStatus.security).toBe('failed');
    expect(result.aspectStatus.performance).toBe('failed');
    expect(result.aspectStatus.quality).toBe('failed');
    expect(result.aspectStatus.tests).toBe('failed');
  });

  it('rawCount reflects pre-dedup count, findings.length reflects post-dedup count', async () => {
    // Return duplicate findings from two different aspects
    const dupeDesc = 'Missing null check on user input';
    mockAnalyzeDiff.mockImplementation(
      (_pr: PRData, _model: string | undefined, _mode: string | undefined, aspect: string) => {
        if (aspect === 'security' || aspect === 'quality') {
          return Promise.resolve(mockResult([
            makeFinding({ file: 'src/foo.ts', line: 10, description: dupeDesc, severity: 'bug' }),
          ]));
        }
        return Promise.resolve(mockResult([]));
      }
    );

    const result = await analyzeTeamQuick(mockPR);

    expect(result.rawCount).toBe(2);
    expect(result.findings.length).toBe(1); // Deduplicated
  });
});

describe('analyzeTeamDeep', () => {
  beforeEach(() => {
    mockAnalyzeDiff.mockReset();
    mockAnalyzeAgentic.mockReset();
    mockFilterEnv.mockReset();
  });

  it('calls analyzeAgentic 4 times (once per aspect) concurrently', async () => {
    mockAnalyzeAgentic.mockResolvedValue(mockResult());

    await analyzeTeamDeep(mockPR, '/tmp/clone');

    expect(mockAnalyzeAgentic).toHaveBeenCalledTimes(4);
    const aspects = mockAnalyzeAgentic.mock.calls.map((call: unknown[]) => call[5]);
    expect(aspects).toContain('security');
    expect(aspects).toContain('performance');
    expect(aspects).toContain('quality');
    expect(aspects).toContain('tests');
  });

  it('returns findings with aspect field stamped on each finding', async () => {
    mockAnalyzeAgentic.mockImplementation(
      (
        _pr: PRData, _clone: string, _model: string | undefined,
        _mode: string | undefined, _verbose: boolean | undefined, aspect: string,
      ) =>
        Promise.resolve(mockResult([makeFinding({ description: `Deep issue from ${aspect}` })]))
    );

    const result = await analyzeTeamDeep(mockPR, '/tmp/clone');

    for (const finding of result.findings) {
      expect(finding.aspect).toBeDefined();
      expect(['security', 'performance', 'quality', 'tests']).toContain(finding.aspect);
    }
  });

  it('passes model, mode, verbose, and clonePath through to analyzeAgentic', async () => {
    mockAnalyzeAgentic.mockResolvedValue(mockResult());

    await analyzeTeamDeep(mockPR, '/tmp/clone', 'claude-opus-4', 'detailed', true);

    for (const call of mockAnalyzeAgentic.mock.calls) {
      expect(call[1]).toBe('/tmp/clone');
      expect(call[2]).toBe('claude-opus-4');
      expect(call[3]).toBe('detailed');
      expect(call[4]).toBe(true);
    }
  });

  it('handles partial failure in deep mode', async () => {
    // Use distinct files to prevent dedup from collapsing findings
    const aspectFiles: Record<string, string> = {
      security: 'src/auth.ts',
      performance: 'src/cache.ts',
      quality: 'src/utils.ts',
    };
    mockAnalyzeAgentic.mockImplementation(
      (
        _pr: PRData, _clone: string, _model: string | undefined,
        _mode: string | undefined, _verbose: boolean | undefined, aspect: string,
      ) => {
        if (aspect === 'tests') {
          return Promise.reject(new Error('Tests agent timed out'));
        }
        return Promise.resolve(mockResult([makeFinding({ file: aspectFiles[aspect], description: `Deep from ${aspect}` })]));
      }
    );

    const result = await analyzeTeamDeep(mockPR, '/tmp/clone');

    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    expect(result.allFailed).toBe(false);
    expect(result.aspectStatus.tests).toBe('failed');
    expect(result.aspectStatus.security).toBe('done');
  });
});

describe('deduplicateFindings', () => {
  it('collapses findings with same file, overlapping lines (within 3), and similar description', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ file: 'src/foo.ts', line: 10, severity: 'suggestion', description: 'Missing null check on user input' }),
      makeFinding({ file: 'src/foo.ts', line: 12, severity: 'bug', description: 'Missing null check on user input value' }),
    ];

    const result = deduplicateFindings(findings);

    expect(result).toHaveLength(1);
  });

  it('keeps higher-severity finding when collapsing duplicates', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ file: 'src/foo.ts', line: 10, severity: 'suggestion', description: 'Missing null check on user input' }),
      makeFinding({ file: 'src/foo.ts', line: 12, severity: 'bug', description: 'Missing null check on user input value' }),
    ];

    const result = deduplicateFindings(findings);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('bug');
  });

  it('does NOT collapse findings with same file but different lines (> 3 apart)', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ file: 'src/foo.ts', line: 10, description: 'Missing null check' }),
      makeFinding({ file: 'src/foo.ts', line: 50, description: 'Missing null check' }),
    ];

    const result = deduplicateFindings(findings);

    expect(result).toHaveLength(2);
  });

  it('does NOT collapse findings with different files even if descriptions match', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ file: 'src/foo.ts', line: 10, description: 'Missing null check' }),
      makeFinding({ file: 'src/bar.ts', line: 10, description: 'Missing null check' }),
    ];

    const result = deduplicateFindings(findings);

    expect(result).toHaveLength(2);
  });

  it('does NOT collapse findings with same location but very different descriptions (similarity < 0.6)', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ file: 'src/foo.ts', line: 10, description: 'SQL injection vulnerability in query builder' }),
      makeFinding({ file: 'src/foo.ts', line: 10, description: 'Consider using a constant for the timeout value' }),
    ];

    const result = deduplicateFindings(findings);

    expect(result).toHaveLength(2);
  });

  it('sorts findings by severity (bug > security > suggestion > nitpick) before dedup', () => {
    const findings: ReviewFinding[] = [
      makeFinding({ file: 'src/a.ts', line: 1, severity: 'nitpick', description: 'Unique nitpick' }),
      makeFinding({ file: 'src/b.ts', line: 1, severity: 'bug', description: 'Unique bug' }),
      makeFinding({ file: 'src/c.ts', line: 1, severity: 'suggestion', description: 'Unique suggestion' }),
      makeFinding({ file: 'src/d.ts', line: 1, severity: 'security', description: 'Unique security' }),
    ];

    // The function should sort by severity internally
    // Since these are all unique (different files), they should all be kept
    // But the higher severity ones should be processed first
    const result = deduplicateFindings(findings);

    expect(result).toHaveLength(4);
  });

  it('higher severity wins during dedup when overlapping findings exist', () => {
    // Create overlapping findings where nitpick comes first in array
    // but bug should win after severity sort
    const findings: ReviewFinding[] = [
      makeFinding({ file: 'src/foo.ts', line: 10, severity: 'nitpick', description: 'This variable name could be better for readability' }),
      makeFinding({ file: 'src/foo.ts', line: 11, severity: 'bug', description: 'This variable name could be better for correctness' }),
    ];

    const result = deduplicateFindings(findings);

    // These descriptions are similar enough (same file + overlapping lines)
    // Bug should win because it has higher severity
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('bug');
  });

  it('handles empty findings array', () => {
    const result = deduplicateFindings([]);
    expect(result).toHaveLength(0);
  });

  it('handles single finding without issue', () => {
    const findings: ReviewFinding[] = [makeFinding()];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
  });
});

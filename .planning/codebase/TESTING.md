# Testing Patterns

**Analysis Date:** 2026-03-05

## Test Framework

**Runner:**
- Vitest (v4.0.18)
- Config: `vitest.config.ts`
- Excludes `.codereview/**` directory (clone artifacts)

**Assertion Library:**
- Vitest built-in `expect()` (compatible with Jest syntax)
- No additional assertion library needed

**Run Commands:**
```bash
npm test                              # Run all tests (vitest run)
npx vitest run                        # Explicit form
npx vitest run tests/output.test.ts   # Run single test file
npm run lint                          # Type-check only (tsc --noEmit)
```

**Test Statistics:**
- 11 test files in `tests/` directory
- 2,663 total lines of test code
- 223+ test cases (count from CLAUDE.md)
- Coverage tracking configured but not enforced by default

## Test File Organization

**Location:**
- All test files in `tests/` directory at project root
- Parallel structure to `src/` but flat namespace: `tests/{module}.test.ts`
- No subdirectories in tests folder

**Naming:**
- Pattern: `{module-name}.test.ts` where module-name matches `src/{module-name}.ts`
- Examples: `analyzer.test.ts` tests `src/analyzer.ts`, `cloner.test.ts` tests `src/cloner.ts`

**File Structure:**
```
tests/
├── analyzer.test.ts       # Tests for analyzer.ts (spawn/execFile mocking)
├── cloner.test.ts         # Tests for cloner.ts (child_process mocking)
├── diff-parser.test.ts    # Tests for diff-parser.ts (pure parsing logic)
├── eval.test.ts           # Tests for eval.ts (fixture-based evaluation)
├── github.test.ts         # Tests for github.ts (Octokit mocking)
├── html-diff-parser.test.ts
├── html-report.test.ts    # Tests for html-report.ts (subprocess hardening)
├── output.test.ts         # Tests for output.ts (console spies)
├── prompt.test.ts         # Tests for prompt.ts (string building)
├── prerequisites.test.ts  # Tests for prerequisites.ts (subprocess checks)
├── security.test.ts       # Security regression tests (39 tests, 5 categories)
└── url-parser.test.ts     # Tests for url-parser.ts (regex parsing)
```

## Test Structure

**Suite Organization:**

Each test file follows standard Vitest pattern:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { /* module under test */ } from '../src/module.js';

describe('SuiteDescription', () => {
  // Optional: setup fixtures
  const mockData = { /* ... */ };

  // Optional: setup/teardown
  beforeEach(() => {
    // Reset mocks, initialize state
  });

  afterEach(() => {
    // Clean up spies, restore mocks
  });

  // Test cases
  it('specific behavior X', () => {
    expect(result).toBe(expected);
  });

  it('specific behavior Y', () => {
    expect(result).toEqual(expected);
  });
});
```

**Patterns:**

1. **Describe nesting:** Multiple levels for logical grouping
   ```typescript
   describe('INP - Input Validation', () => {
     describe('validateGitArg rejects dangerous inputs', () => {
       it('rejects branch names starting with --upload-pack=evil', () => {
       });
     });
     describe('validateGitArg accepts valid GitHub names', () => {
       it('accepts repo name with dots: my.repo', () => {
       });
     });
   });
   ```

2. **Mock fixture creation:** Minimal data structures for testing
   ```typescript
   const mockPR: PRData = {
     number: 42,
     title: 'Add feature X',
     body: 'PR description',
     author: 'testauthor',
     baseBranch: 'main',
     headBranch: 'feature-x',
     // ... other required fields
   };
   ```

3. **Setup/teardown:** Spies and mocks reset before each test
   ```typescript
   let logSpy: ReturnType<typeof vi.spyOn>;

   beforeEach(() => {
     logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
   });

   afterEach(() => {
     logSpy.mockRestore();
   });
   ```

## Mocking

**Framework:** Vitest native `vi.mock()` and `vi.fn()`

**Mocking Strategies:**

**1. Module mocks (vi.mock):**
Used for subprocess modules (`child_process`, `fs`, `util`):

```typescript
const mockExecFile = vi.fn();

vi.mock('node:util', () => ({
  promisify: () => mockExecFile,
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
}));
```

**2. Function stubs (vi.fn):**
For callback arguments and return value mocking:

```typescript
const mockChild = { stdin: { end: vi.fn() } };
mockExecFile.mockReturnValue(Promise.resolve({ stdout: '...' }));
```

**3. Console spies (vi.spyOn):**
For testing terminal output without actual printing:

```typescript
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
printPRSummary(mockPR);
const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
expect(output).toContain('Add feature X');
logSpy.mockRestore();
```

**4. Dynamic imports with mocks:**
Mocks must be established before importing the module under test:

```typescript
vi.mock('node:child_process', () => ({ /* ... */ }));
vi.mock('node:util', () => ({ /* ... */ }));

const { analyzeDiff } = await import('../src/analyzer.js');
```

**What to Mock:**

- **External subprocess calls:** `execFile`, `spawn`, `execFileSync` (all child_process operations)
- **File system operations:** `mkdirSync`, `readFileSync`, `access`, `rm` (fs, fs/promises)
- **Network calls:** Octokit methods mocked in `github.test.ts`
- **Async operations:** Promises wrapped in mocks with controllable resolution/rejection

**What NOT to Mock:**

- **Pure functions:** `parsePRUrl()`, `validateGitArg()`, regex parsing, string manipulation
- **Zod schemas:** Use real Zod validation, don't mock `z.object()` or `parse()`
- **Built-in Node APIs** (unless subprocess-related): `Object`, `Array`, `String` methods
- **Structural patterns:** Don't mock module structure, test real imports

**Example: Avoiding mock pollution:**

```typescript
// ✅ Good: test real parsing logic
it('accepts repo name with dots: my.repo', () => {
  expect(() => validateGitArg('my.repo', 'Repository name')).not.toThrow();
});

// ❌ Bad: mocking the function being tested
vi.mock('./cloner.ts', () => ({
  validateGitArg: vi.fn(() => true), // DON'T DO THIS
}));
```

## Fixtures and Factories

**Test Data:**

Helper factory functions for creating minimal valid test objects:

```typescript
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
```

**JSON Fixture Loading (ESM-compatible):**

From `src/eval.ts`, using `createRequire` to load JSON:

```typescript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Then load JSON fixtures via require('path/to/fixture.json')
```

Allows fixture-based testing without converting JSON to TypeScript literals.

**Location:**
- Inline in test files as constants (simple cases)
- Could be in separate JSON files with `createRequire` for large datasets
- No shared fixture directory currently

## Coverage

**Requirements:** No minimum coverage enforced

**Viewing Coverage:**
```bash
# Vitest can generate coverage with additional setup
# Currently no coverage reporting configured
```

**Target Areas:**
- Security tests (39 tests in `security.test.ts`) cover INP/SUB/CRED/API/CLN categories
- Core logic (parsing, validation, formatting) have high coverage
- CLI orchestration tested via integration-level tests

## Test Types

**Unit Tests:**
- **Scope:** Individual functions with mocked dependencies
- **Approach:** Pure functions, input validation, error handling
- **Examples:** `diff-parser.test.ts` tests `parseDiffHunks()` with raw diff strings
- **Isolation:** Heavy use of mocks for filesystem and subprocess

```typescript
// Unit test: pure parsing logic, no mocks needed
it('parses hunk headers correctly', () => {
  const hunks = parseDiffHunks('@@ -1,3 +1,5 @@\n...');
  expect(hunks.get('file.ts')).toEqual([{ newStart: 1, newCount: 5 }]);
});
```

**Integration Tests:**
- **Scope:** Multiple modules working together, with mocked external dependencies
- **Approach:** Real imports, mocked subprocess calls and network calls
- **Examples:** `analyzer.test.ts` tests the full analysis flow with mocked `execFile`

```typescript
// Integration test: analyzer module with mocked Claude CLI subprocess
it('reads total_cost_usd from wrapper into meta.cost_usd', async () => {
  mockExecFileReturn(buildWrapper({ total_cost_usd: 0.0423 }));
  const result = await analyzeDiff(mockPR);
  expect(result.meta!.cost_usd).toBe(0.0423);
});
```

**Security/Regression Tests:**
- **Scope:** Static analysis + integration-level input testing
- **Approach:** Real module imports + controlled malicious inputs
- **Examples:** `security.test.ts` with 39 tests across 5 threat categories

```typescript
// INP: Input Validation test
it('rejects branch names starting with --upload-pack=evil', () => {
  expect(() => validateGitArg('--upload-pack=evil', 'Branch name')).toThrow('starts with a dash');
});

// SUB: Subprocess hardening verification (static)
it('html-report.ts uses execFile, not exec() with string interpolation', () => {
  const source = readFileSync(join(SRC_DIR, 'html-report.ts'), 'utf-8');
  expect(source).toContain('execFile');
});

// CRED: Credential scrubbing test
it('scrubSecrets replaces GitHub tokens', () => {
  const scrubbed = scrubSecrets('Token is ghp_abc123def456');
  expect(scrubbed).toContain('[REDACTED]');
});
```

**E2E Tests:**
- **Status:** Not used
- **Rationale:** subprocess invocation already tested via mocked integration tests; full CLI testing delegated to manual verification

## Common Patterns

**Async Testing:**

All async functions tested with `async/await`:

```typescript
it('reads total_cost_usd from wrapper into meta.cost_usd', async () => {
  mockExecFileReturn(buildWrapper({ total_cost_usd: 0.0423 }));
  const result = await analyzeDiff(mockPR);
  expect(result.meta!.cost_usd).toBe(0.0423);
});
```

Error handling in async tests uses try/expect pattern:

```typescript
it('throws on invalid JSON response', async () => {
  mockExecFileReturn(buildWrapper({ result: 'invalid json' }));
  try {
    await analyzeDiff(mockPR);
    expect.fail('should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('parsing');
  }
});
```

**Error Testing:**

Testing error conditions by verifying throw behavior:

```typescript
describe('validateGitArg rejects dangerous inputs', () => {
  it('rejects branch names starting with --upload-pack=evil', () => {
    expect(() => validateGitArg('--upload-pack=evil', 'Branch name')).toThrow('starts with a dash');
  });

  it('rejects names containing null bytes (repo\\0name)', () => {
    expect(() => validateGitArg('repo\0name', 'Repository name')).toThrow('null byte');
  });
});
```

**Mock Return Values:**

Setting up mocked subprocess responses:

```typescript
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
```

**Spy Assertions:**

Verifying function calls and output:

```typescript
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

it('prints the PR title', () => {
  printPRSummary(mockPR);
  const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
  expect(output).toContain('Add feature X');
});

afterEach(() => {
  logSpy.mockRestore();
});
```

**Type Safety in Tests:**

Tests use full type annotations for clarity:

```typescript
const logSpy: ReturnType<typeof vi.spyOn>;
const mockExecFile: typeof import('node:util').promisify;
const result: AnalysisResult = await analyzeDiff(mockPR);
```

## Notable Test Characteristics

**Security Test Depth:**
- `security.test.ts` is 368 lines, covering 39 separate test cases
- Tests 5 threat categories: INP (input validation), SUB (subprocess hardening), CRED (credential safety), API (blast radius), CLN (cleanup)
- Combines dynamic tests (calling functions with malicious inputs) and static analysis (reading source to verify mitigations exist)

**No Test Utilities Library:**
- Tests don't use testing-library, jest-dom, or other assertion helpers
- Vitest's `expect()` is sufficient; custom helpers built inline when needed

**Module Mock Lifecycle:**
- Mocks established before importing module under test via top-level `await import()`
- Allows clean isolation of test contexts
- Pattern unique to ESM + Vitest

**Minimal Setup/Teardown:**
- Only restore spies in `afterEach()` (mocks cleared automatically per Vitest docs)
- No global setup files
- State cleaned up between tests via mock `.mockClear()`

---

*Testing analysis: 2026-03-05*

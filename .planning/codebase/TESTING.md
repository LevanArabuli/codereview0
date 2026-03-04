# Testing Patterns

**Analysis Date:** 2026-03-04

## Test Framework

**Runner:**
- Vitest v4.0.18
- Config: `vitest.config.ts` (excludes `.codereview/**` from test runs)

**Assertion Library:**
- Vitest built-in (`expect`)

**Run Commands:**
```bash
npm test                                    # Run all tests (vitest run)
npx vitest run tests/output.test.ts         # Run single file
npx vitest run                              # Run once (no watch)
# No coverage command configured — no coverage targets enforced
```

## Test File Organization

**Location:** Separate `tests/` directory at project root, not co-located with source

**Naming:** `{module-name}.test.ts` mirroring `src/{module-name}.ts`

**Structure:**
```
tests/
├── analyzer.test.ts         # src/analyzer.ts
├── cloner.test.ts           # src/cloner.ts
├── eval.test.ts             # src/eval.ts (eval infra + PR fixture tests)
├── github.test.ts           # src/github.ts
├── html-diff-parser.test.ts # src/html-diff-parser.ts
├── html-report.test.ts      # src/html-report.ts
├── output.test.ts           # src/output.ts
├── prerequisites.test.ts    # src/prerequisites.ts
├── prompt.test.ts           # src/prompt.ts
├── security.test.ts         # cross-cutting security invariants
├── url-parser.test.ts       # src/url-parser.ts
└── fixtures/
    ├── pr-1-small.json      # Small PR eval fixture
    ├── pr-2-medium.json     # Medium PR eval fixture
    └── pr-3-large.json      # Large PR eval fixture
```

**Notable:** No test file for `src/cli.ts`, `src/formatter.ts`, `src/diff-parser.ts`, `src/review-builder.ts`, `src/types.ts`, `src/errors.ts` (errors functions tested indirectly via `security.test.ts`).

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('functionName', () => {
  describe('valid inputs', () => {
    it('does the expected thing', () => {
      const result = functionName(input);
      expect(result).toEqual(expectedValue);
    });
  });

  describe('invalid inputs', () => {
    it('returns null for empty string', () => {
      expect(functionName('')).toBeNull();
    });
  });
});
```

**Patterns:**
- Nested `describe` blocks group related scenarios: `describe('valid URLs', ...)`, `describe('invalid inputs', ...)`
- `it()` descriptions are plain English, action-oriented: `'parses a standard GitHub PR URL'`, `'returns null for missing PR number'`
- Setup: `beforeEach` to set up spies and clear mocks; `afterEach` to restore spies
- Pure functions (no side effects): no setup/teardown needed, tests are plain `it()` with direct assertions
- `console.log` / `console.error` spy pattern for terminal output functions (see Mocking section)

## Mocking

**Framework:** Vitest `vi.mock()` for module mocks, `vi.fn()` for function stubs, `vi.spyOn()` for method spies

**Module Mocking Pattern (for subprocess-dependent modules):**
```typescript
// Declare mock objects before vi.mock calls
const mockChild = { stdin: { end: vi.fn() } };
const mockExecFile = vi.fn();

// Override promisify to return the mock directly
vi.mock('node:util', () => ({
  promisify: () => mockExecFile,
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

// Dynamic import AFTER mocks are set up
const { analyzeDiff } = await import('../src/analyzer.js');
```

**Console Spy Pattern (for output functions):**
```typescript
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
```

**vi.mocked() Pattern:**
```typescript
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));
const mockedExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  mockedExecFileSync.mockReset();
});

mockedExecFileSync.mockImplementation((cmd, args) => {
  if ((args as string[])[0] === 'gh') throw new Error('not found');
  return Buffer.from('');
});
```

**What to Mock:**
- All subprocess calls (`execFile`, `execFileSync`, `spawn`) — never actually invoke system tools in tests
- File system operations (`writeFileSync`, `mkdirSync`, `access`, `rm`) when testing code that writes files
- `console.log` / `console.error` when testing terminal output functions
- External packages (e.g., `@octokit/rest`) via hand-written mock object factories

**What NOT to Mock:**
- Pure functions with no side effects (URL parsing, prompt building, diff parsing, format functions)
- The functions under test themselves
- Security test suite reads actual source files with `readFileSync` for static analysis — this is intentional

## Fixtures and Factories

**Test Data Factories:**
```typescript
// Mock object factory with optional overrides
function makePRData(overrides?: Partial<PRData>): PRData {
  return {
    number: 42,
    title: 'Add feature X',
    body: '',
    author: 'testuser',
    // ... all required fields
    ...overrides,
  };
}

// Minimal object builder for test-local use
function makeFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    file: 'src/foo.ts',
    line: 2,
    severity: 'bug',
    confidence: 'high',
    category: 'Logic Error',
    description: 'Variable is reassigned incorrectly.',
    ...overrides,
  };
}
```

**Module-level mock objects:** Declare `const mockPR: PRData = { ... }` at module scope when a single object is reused across all tests in a file.

**JSON Fixtures (eval tests):**
```typescript
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pr1Fixture = require('./fixtures/pr-1-small.json');
```
- Required because of ESM restrictions — `import()` works but `createRequire` is the established pattern for synchronous JSON loading
- Fixtures live in `tests/fixtures/` as JSON files

**Wrapper Builder for subprocess mocks:**
```typescript
function buildWrapper(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.0423,
    is_error: false,
    ...overrides,
  };
}

function mockExecFileReturn(wrapper: Record<string, unknown>) {
  mockExecFile.mockReturnValue(
    Object.assign(Promise.resolve({ stdout: JSON.stringify(wrapper) }), { child: mockChild }),
  );
}
```

**Mock Octokit Factory:**
```typescript
function createMockOctokit(overrides?: { body?: string | null; user?: ... }) {
  return {
    pulls: {
      get: async ({ mediaType }: ...) => { ... },
      listFiles: async () => ({ data: filesData }),
    },
  } as unknown as Octokit;
}
```

**Location:**
- Helper functions defined at the top of each test file (no shared test utility files)
- JSON fixtures in `tests/fixtures/`

## Coverage

**Requirements:** None enforced — no coverage thresholds configured

**View Coverage:**
```bash
# Not configured — no coverage script in package.json
```

## Test Types

**Unit Tests:**
- Primary test type — all 11 test files test individual module functions in isolation
- Pure functions tested with direct input/output assertions (no mocks needed)
- Side-effectful functions tested with `vi.spyOn(console, 'log')` or module mocks

**Integration Tests:**
- `security.test.ts` functions as integration/regression tests for security invariants
- Tests call actual module functions with malicious inputs (e.g., `validateGitArg('--upload-pack=evil', 'Branch name')`)
- Tests also perform static analysis by reading source files with `readFileSync` and asserting source patterns

**Fixture-Based Eval Tests:**
- `eval.test.ts` loads JSON PR fixtures and validates the evaluation scoring logic
- Self-match pattern: feed fixture's expected findings back through the matcher to verify perfect recall

**E2E Tests:** Not present — no tests invoke actual `claude` or `gh` CLIs

## Common Patterns

**Async Testing:**
```typescript
it('reads total_cost_usd from wrapper into meta.cost_usd', async () => {
  mockExecFileReturn(buildWrapper({ total_cost_usd: 0.0423 }));

  const result = await analyzeDiff(mockPR);

  expect(result.meta).toBeDefined();
  expect(result.meta!.cost_usd).toBe(0.0423);
});
```

**Error/Throw Testing:**
```typescript
it('rejects branch names starting with --upload-pack=evil', () => {
  expect(() => validateGitArg('--upload-pack=evil', 'Branch name')).toThrow('starts with a dash');
});
```

**Ordering/Sorting Tests:**
```typescript
// Join all console.log calls and use indexOf for ordering assertions
const output = logSpy.mock.calls.map((c) => c[0] ?? '').join('\n');
expect(output.indexOf('Bug A')).toBeLessThan(output.indexOf('Bug B low'));
```

**Static Source Analysis (security tests only):**
```typescript
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC_DIR = resolve(import.meta.dirname, '..', 'src');

it('no src/ file contains shell: true', () => {
  const srcFiles = readdirSync(SRC_DIR).filter(f => f.endsWith('.ts'));
  for (const file of srcFiles) {
    const source = readFileSync(join(SRC_DIR, file), 'utf-8');
    expect(source).not.toContain('shell: true');
  }
});
```

**Security Test Category Structure:**
The security test suite (`tests/security.test.ts`) is organized into 5 categories matching the security model:
- `INP - Input Validation` — tests `validateGitArg()` and `getClonePath()` with malicious inputs
- `SUB - Subprocess Hardening` — static analysis verifying `execFile` usage and no `shell: true`
- `CRED - Credential Safety` — tests `scrubSecrets()` and `sanitizeError()` token redaction
- `API - API Safety` — static analysis of Octokit method whitelist and PENDING review invariant
- `CLN - Cleanup` — static analysis for SIGINT handler and try/finally blocks

**Do not modify `security.test.ts`** without reading `SECURITY.md` and understanding the full threat model.

---

*Testing analysis: 2026-03-04*

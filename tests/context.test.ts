import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { PRFile } from '../src/types.js';

// Mock github.ts to control fetchFileContent
vi.mock('../src/github.js', () => ({
  fetchFileContent: vi.fn(),
}));

// Import after mock setup
import { fetchFileContent } from '../src/github.js';
import {
  extractRelativeImports,
  resolveImportPath,
  inferRelatedByNaming,
  discoverRelatedFiles,
  gatherQuickContext,
  buildExplorationGuidance,
} from '../src/context.js';

const mockFetchFileContent = fetchFileContent as ReturnType<typeof vi.fn>;

describe('extractRelativeImports', () => {
  it('finds import X from "./foo" paths', () => {
    const source = `import { bar } from './foo';\nimport baz from '../utils';`;
    const imports = extractRelativeImports(source);
    expect(imports).toContain('./foo');
    expect(imports).toContain('../utils');
  });

  it('finds require("./bar") paths', () => {
    const source = `const x = require('./bar');\nconst y = require('../lib/helper');`;
    const imports = extractRelativeImports(source);
    expect(imports).toContain('./bar');
    expect(imports).toContain('../lib/helper');
  });

  it('ignores external packages (no ./ or ../ prefix)', () => {
    const source = `import { Octokit } from '@octokit/rest';\nimport zod from 'zod';`;
    const imports = extractRelativeImports(source);
    expect(imports).toHaveLength(0);
  });

  it('ignores dynamic imports and template literals', () => {
    const source = `const mod = await import(\`./\${name}\`);\nconst x = import("./static");`;
    const imports = extractRelativeImports(source);
    // Should find static import("./static") but not template literal
    // The template literal should not produce a result because backtick is not single/double quote
    expect(imports.filter(i => i.includes('${'))).toHaveLength(0);
  });

  it('finds side-effect imports', () => {
    const source = `import './setup';`;
    const imports = extractRelativeImports(source);
    expect(imports).toContain('./setup');
  });

  it('deduplicates identical paths', () => {
    const source = `import { a } from './utils';\nimport { b } from './utils';`;
    const imports = extractRelativeImports(source);
    const utilsCount = imports.filter(i => i === './utils').length;
    expect(utilsCount).toBe(1);
  });
});

describe('resolveImportPath', () => {
  it('generates candidates with .ts, .tsx, .js, .jsx extensions and /index variants', () => {
    const candidates = resolveImportPath('src/foo.ts', './utils');
    expect(candidates).toContain('src/utils.ts');
    expect(candidates).toContain('src/utils.tsx');
    expect(candidates).toContain('src/utils.js');
    expect(candidates).toContain('src/utils.jsx');
    expect(candidates).toContain('src/utils/index.ts');
    expect(candidates).toContain('src/utils/index.tsx');
    expect(candidates).toContain('src/utils/index.js');
    expect(candidates).toContain('src/utils/index.jsx');
  });

  it('returns path as-is when it already has an extension', () => {
    const candidates = resolveImportPath('src/foo.ts', './bar.js');
    expect(candidates).toEqual(['src/bar.js']);
  });

  it('resolves parent directory imports', () => {
    const candidates = resolveImportPath('src/lib/deep.ts', '../helpers');
    expect(candidates).toContain('src/helpers.ts');
    expect(candidates).toContain('src/helpers/index.ts');
  });
});

describe('inferRelatedByNaming', () => {
  it('generates test file paths (foo.test.ts, foo.spec.ts) and barrel (index.ts)', () => {
    const related = inferRelatedByNaming('src/utils.ts');
    const paths = related.map(r => r.path);
    expect(paths).toContain('src/utils.test.ts');
    expect(paths).toContain('src/utils.spec.ts');
    expect(paths).toContain('src/index.ts');
  });

  it('generates tests/ directory variants for src/ files', () => {
    const related = inferRelatedByNaming('src/github.ts');
    const paths = related.map(r => r.path);
    expect(paths).toContain('tests/github.test.ts');
    expect(paths).toContain('tests/github.spec.ts');
  });

  it('marks test candidates as reason "test" and barrel as reason "barrel"', () => {
    const related = inferRelatedByNaming('src/foo.ts');
    const testFiles = related.filter(r => r.reason === 'test');
    const barrelFiles = related.filter(r => r.reason === 'barrel');
    expect(testFiles.length).toBeGreaterThan(0);
    expect(barrelFiles.length).toBeGreaterThan(0);
  });
});

describe('discoverRelatedFiles', () => {
  it('excludes files already in the diff', () => {
    const changedFiles: PRFile[] = [
      { filename: 'src/foo.ts', status: 'modified', additions: 10, deletions: 5, changes: 15 },
      { filename: 'src/bar.ts', status: 'modified', additions: 5, deletions: 2, changes: 7 },
    ];
    const contents = new Map<string, string>();
    // foo.ts imports bar.ts -- but bar.ts is already in the diff
    contents.set('src/foo.ts', `import { something } from './bar';`);

    const discovered = discoverRelatedFiles(changedFiles, contents);
    const paths = discovered.map(d => d.path);
    // bar.ts should be excluded because it's in changedFiles
    expect(paths).not.toContain('src/bar.ts');
  });

  it('deduplicates files found by both import and naming patterns, keeping higher-priority reason', () => {
    const changedFiles: PRFile[] = [
      { filename: 'src/foo.ts', status: 'modified', additions: 10, deletions: 5, changes: 15 },
    ];
    const contents = new Map<string, string>();
    // foo.ts imports its own test file (contrived but tests dedup)
    contents.set('src/foo.ts', `import { helper } from './foo.test';`);

    const discovered = discoverRelatedFiles(changedFiles, contents);
    // foo.test.ts found by both import parsing and naming pattern
    const fooTestEntries = discovered.filter(d => d.path === 'src/foo.test.ts');
    expect(fooTestEntries).toHaveLength(1);
    // import reason is higher priority than test
    expect(fooTestEntries[0].reason).toBe('import');
  });

  it('prioritizes imports first, then tests, then types, then barrels', () => {
    const changedFiles: PRFile[] = [
      { filename: 'src/main.ts', status: 'modified', additions: 10, deletions: 0, changes: 10 },
    ];
    const contents = new Map<string, string>();
    contents.set('src/main.ts', `import { x } from './alpha';`);

    const discovered = discoverRelatedFiles(changedFiles, contents);

    // imports should come before test/barrel results
    const importIdx = discovered.findIndex(d => d.reason === 'import');
    const testIdx = discovered.findIndex(d => d.reason === 'test');
    const barrelIdx = discovered.findIndex(d => d.reason === 'barrel');

    if (importIdx !== -1 && testIdx !== -1) {
      expect(importIdx).toBeLessThan(testIdx);
    }
    if (testIdx !== -1 && barrelIdx !== -1) {
      expect(testIdx).toBeLessThan(barrelIdx);
    }
  });
});

describe('gatherQuickContext', () => {
  const mockOctokit = {} as Octokit;

  beforeEach(() => {
    mockFetchFileContent.mockReset();
  });

  it('respects maxFiles cap (5)', async () => {
    const changedFiles: PRFile[] = [
      { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    ];
    const contents = new Map<string, string>();
    contents.set('src/a.ts', [
      `import { b } from './b';`,
      `import { c } from './c';`,
      `import { d } from './d';`,
      `import { e } from './e';`,
      `import { f } from './f';`,
      `import { g } from './g';`,
      `import { h } from './h';`,
    ].join('\n'));

    // All fetches succeed with small content
    mockFetchFileContent.mockResolvedValue('export const x = 1;');

    const result = await gatherQuickContext(mockOctokit, 'owner', 'repo', 'ref123', changedFiles, contents);
    expect(result.relatedFiles!.length).toBeLessThanOrEqual(5);
  });

  it('skips files over per-file size limit (50,000 chars)', async () => {
    const changedFiles: PRFile[] = [
      { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    ];
    const contents = new Map<string, string>();
    contents.set('src/a.ts', `import { big } from './big';`);

    // Return a file that exceeds the per-file limit
    const largeContent = 'x'.repeat(50_001);
    mockFetchFileContent.mockResolvedValue(largeContent);

    const result = await gatherQuickContext(mockOctokit, 'owner', 'repo', 'ref123', changedFiles, contents);
    // The large file should be skipped
    expect(result.relatedFiles!.length).toBe(0);
  });

  it('respects total size budget (200,000 chars)', async () => {
    const changedFiles: PRFile[] = [
      { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    ];
    const contents = new Map<string, string>();
    contents.set('src/a.ts', [
      `import { b } from './b';`,
      `import { c } from './c';`,
      `import { d } from './d';`,
    ].join('\n'));

    // Each file is 80K -- first two fit in 200K budget, third does not
    const mediumContent = 'y'.repeat(80_000);
    mockFetchFileContent.mockResolvedValue(mediumContent);

    const result = await gatherQuickContext(mockOctokit, 'owner', 'repo', 'ref123', changedFiles, contents);
    // Only 2 files should fit (80K + 80K = 160K < 200K, but 80K + 80K + 80K = 240K > 200K)
    expect(result.relatedFiles!.length).toBe(2);
  });

  it('returns empty relatedFiles array when no related files found', async () => {
    const changedFiles: PRFile[] = [
      { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    ];
    const contents = new Map<string, string>();
    contents.set('src/a.ts', `const x = 42;`); // no imports

    // No naming pattern matches will succeed
    mockFetchFileContent.mockResolvedValue(null);

    const result = await gatherQuickContext(mockOctokit, 'owner', 'repo', 'ref123', changedFiles, contents);
    expect(result.relatedFiles).toEqual([]);
  });
});

describe('buildExplorationGuidance', () => {
  it('generates per-file category entries for each changed file', () => {
    const changedFiles: PRFile[] = [
      { filename: 'src/auth.ts', status: 'modified', additions: 10, deletions: 5, changes: 15 },
      { filename: 'src/db.ts', status: 'added', additions: 50, deletions: 0, changes: 50 },
    ];

    const result = buildExplorationGuidance(changedFiles);
    expect(result.explorationGuidance).toHaveLength(2);
    expect(result.explorationGuidance![0].file).toBe('src/auth.ts');
    expect(result.explorationGuidance![1].file).toBe('src/db.ts');
  });

  it('includes callers, tests, type-definitions categories', () => {
    const changedFiles: PRFile[] = [
      { filename: 'src/utils.ts', status: 'modified', additions: 5, deletions: 2, changes: 7 },
    ];

    const result = buildExplorationGuidance(changedFiles);
    const categories = result.explorationGuidance![0].categories;
    expect(categories).toContain('callers');
    expect(categories).toContain('tests');
    expect(categories).toContain('type-definitions');
  });
});

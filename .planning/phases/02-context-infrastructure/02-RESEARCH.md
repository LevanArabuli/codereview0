# Phase 2: Context Infrastructure - Research

**Researched:** 2026-03-04
**Domain:** GitHub API file fetching, TypeScript import parsing, prompt engineering for codebase exploration
**Confidence:** HIGH

## Summary

Phase 2 adds structured context gathering for both review modes. Quick mode needs to discover related files (imports, tests, type definitions) from changed files, fetch them via the Octokit `repos.getContent` API, and inject their content into the prompt as XML blocks. Deep mode needs its existing "Codebase Exploration" section replaced with structured per-file category guidance (callers, tests, types). Both modes share a `ReviewContext` type as their data contract.

The implementation is straightforward because: (1) the Octokit `repos.getContent` API is already available via the existing `@octokit/rest` v22 dependency -- no new dependencies required; (2) TypeScript/JavaScript import parsing for path discovery can be done with regex matching the well-defined `import ... from '...'` and `require('...')` syntax; (3) the prompt functions (`buildPrompt` and `buildAgenticPrompt`) already accept `PRData` and can be extended to accept `ReviewContext` as a second parameter.

**Primary recommendation:** Create a new `context.ts` module containing the discovery logic (import parsing + naming patterns), the fetching logic (Octokit `repos.getContent`), and the `ReviewContext` type in `types.ts`. Wire it into `cli.ts` between `fetchPRData()` and the prompt construction step.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Combine import parsing AND naming pattern inference to identify related files
- Parse imports from full file content of changed files (fetch each changed file via Octokit contents API, then extract imports)
- Naming patterns to recognize: test files (foo.test.ts, foo.spec.ts), type/interface files imported by changed files, index.ts/barrel files in the same directory
- Discovery runs for quick mode only -- deep mode already has the cloned repo and gets category-based guidance instead
- TypeScript/JavaScript import parsing only for now; other languages fall back to naming pattern inference only
- Fetch related files from the PR head branch (head SHA) -- shows the state as the PR author sees it
- Skip files that are already in the diff (already visible to Claude) -- use the file budget for files NOT in the diff
- Full file content in `<related_file path="...">` XML tags in the prompt
- Context gathering always on by default -- no opt-in flag needed
- Prioritization when 5-file cap forces choices: imports first, then tests, then type definitions
- Replace the current unguided "Codebase Exploration" section with structured category guidance
- Guide Claude on WHAT to look for by category: for each changed file, find and read its callers, its test file, its type definitions
- Claude finds the actual files itself (has full repo access) -- don't compute a named file list
- Maximum 5 related files fetched for quick mode
- Per-file size limit: truncate large files
- Total context size budget: cap total related file content (character limit)
- Stick to code files only -- no config files in the related file budget
- File fetch failures skipped silently -- log in verbose mode only
- Context is best-effort enrichment; review proceeds with whatever context was gathered
- Show context gathering stats in verbose mode following existing `[debug]` pattern
- Shared ReviewContext type in types.ts with mode-specific optional fields
- Quick mode populates relatedFiles (fetched file contents)
- Deep mode populates explorationGuidance (structured category list for the prompt)

### Claude's Discretion
- Exact per-file size threshold for truncation
- Exact total character budget for combined related file content
- Import parsing implementation details (regex vs AST)
- Specific wording of deep mode category guidance prompt text
- How to resolve relative imports to actual filenames
- Whether to deduplicate related files discovered by both import parsing and naming patterns

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CTX-01 | Deep mode prompt explicitly guides Claude on which adjacent files to explore (callers, tests, type definitions for changed modules) | Replace `## Codebase Exploration` section in `buildAgenticPrompt()` with structured per-file category guidance using `ReviewContext.explorationGuidance` |
| CTX-02 | Quick mode fetches 3-5 related files via Octokit /contents API (imports, tests, types) to enrich context beyond the diff | New `context.ts` module: import parsing + naming patterns for discovery, `repos.getContent` for fetching, XML `<related_file>` tags in prompt |
| CTX-03 | ReviewContext type serves as shared data contract between quick and deep modes for gathered context | `ReviewContext` interface in `types.ts` with `relatedFiles` (quick) and `explorationGuidance` (deep) optional fields |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @octokit/rest | 22.0.1 | GitHub API client (repos.getContent) | Already a project dependency; provides typed access to the contents API |
| Node.js Buffer | built-in | Base64 decoding of file content | `Buffer.from(content, 'base64').toString('utf-8')` -- zero dependencies |
| Node.js path | built-in | Relative import resolution | `path.resolve`, `path.dirname`, `path.join` for resolving `./relative` imports |

### Supporting
No additional libraries needed. All functionality is achievable with existing dependencies and Node.js built-ins.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex import parsing | AST parsing (ts-morph, typescript) | AST is more accurate but adds a heavy dependency (typescript compiler API is 50MB+). Regex handles the common cases (static imports, require) reliably for TS/JS. Edge cases (dynamic imports, template literal paths) don't matter for related-file discovery. |
| Base64 decode (Buffer) | mediaType: { format: 'raw' } | Raw format returns content as string directly, avoiding base64 decode. However, the TypeScript types for raw format return `string` typed as `unknown` requiring ugly casts. Base64 with type narrowing is more predictable. Either approach works. |

## Architecture Patterns

### Recommended Project Structure
```
src/
  context.ts          # NEW: Related file discovery + fetching for quick mode
  types.ts            # MODIFIED: Add ReviewContext interface
  prompt.ts           # MODIFIED: Accept ReviewContext, add related files to quick prompt, restructure deep prompt exploration section
  github.ts           # MODIFIED: Add fetchFileContent() function
  cli.ts              # MODIFIED: Wire context gathering between fetchPRData and prompt construction
  output.ts           # MODIFIED: (optional) context stats in verbose output already covered by printDebug
```

### Pattern 1: Two-Phase Context Gathering (Discover then Fetch)
**What:** Separate discovery (which files are related) from fetching (get their content). Discovery produces a prioritized list of file paths. Fetching retrieves content for the top N files within budget.
**When to use:** Always for quick mode context.
**Example:**
```typescript
// Phase 1: Discover related files from changed files
// - Parse imports from each changed file's content
// - Infer naming patterns (test files, barrel files)
// - Deduplicate and prioritize: imports > tests > types
// - Filter out files already in the diff
const candidates = discoverRelatedFiles(changedFiles, changedFileContents);

// Phase 2: Fetch top N files within budget
const relatedFiles = await fetchRelatedFiles(octokit, owner, repo, ref, candidates, {
  maxFiles: 5,
  maxFileSize: 50_000,     // per-file truncation threshold
  maxTotalSize: 200_000,   // total character budget
});
```

### Pattern 2: Octokit repos.getContent with Type Narrowing
**What:** Fetch a single file's content from a specific ref (commit SHA), decode base64, handle 404 gracefully.
**When to use:** Every file fetch in quick mode context gathering.
**Example:**
```typescript
// Source: GitHub REST API docs + Octokit TypeScript type narrowing patterns
async function fetchFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
    // Type narrowing: must not be array (directory) and must be file type
    if (Array.isArray(data) || data.type !== 'file' || !data.content) {
      return null;
    }
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch {
    return null; // 404 or other error -- silent skip
  }
}
```

### Pattern 3: Regex Import Parsing for TS/JS
**What:** Extract import paths from TypeScript/JavaScript source using regex.
**When to use:** To discover which files a changed file depends on.
**Example:**
```typescript
// Matches: import ... from './path', import ... from '../path'
// Matches: import './path' (side-effect imports)
// Matches: require('./path')
// Does NOT match: external packages (no ./ or ../ prefix)
const IMPORT_PATTERN = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\(\s*)['"](\.[^'"]+)['"]/g;

function extractRelativeImports(source: string): string[] {
  const imports: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = IMPORT_PATTERN.exec(source)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}
```

### Pattern 4: ReviewContext Type Design
**What:** A type-safe union of quick-mode and deep-mode context data.
**When to use:** As the shared contract between context gathering and prompt construction.
**Example:**
```typescript
// In types.ts
export interface RelatedFile {
  path: string;
  content: string;
  reason: 'import' | 'test' | 'type' | 'barrel';
}

export interface ExplorationCategory {
  file: string;
  categories: string[]; // e.g., ['callers', 'tests', 'type-definitions']
}

export interface ReviewContext {
  relatedFiles?: RelatedFile[];           // Quick mode: fetched file contents
  explorationGuidance?: ExplorationCategory[]; // Deep mode: structured guidance
}
```

### Pattern 5: Deep Mode Structured Exploration Guidance
**What:** Replace the generic "Codebase Exploration" section with per-file category guidance.
**When to use:** In `buildAgenticPrompt()` when ReviewContext has explorationGuidance.
**Example:**
```typescript
// Instead of generic "Look for broken callers, pattern violations..."
// Generate per-file exploration guidance:
`## Codebase Exploration

For each changed file, explore the following categories to find cross-file issues:

${explorationGuidance.map(g => `### ${g.file}
- **Callers**: Find functions/modules that import or call into this file. Check if the changes break their expectations.
- **Tests**: Find and read test files for this module. Assess whether tests cover the changed behavior.
- **Type definitions**: If this file exports types consumed elsewhere, check consumers for compatibility.`).join('\n\n')}

Every cross-file finding MUST reference specific files and lines as evidence.`
```

### Anti-Patterns to Avoid
- **Fetching files already in the diff:** Wastes the 5-file budget on content Claude already has. Filter against `PRData.files` filenames.
- **Fetching config/generated files:** package.json, tsconfig.json, lock files, .generated files provide low review value and bloat context. Stick to code files (.ts, .js, .tsx, .jsx, etc.).
- **Sequential file fetching:** Use `Promise.allSettled` for parallel fetching (matches existing `fetchPRData` pattern).
- **Blocking on context failures:** Context is enrichment, not required. Never let a 404 or API rate limit crash the review.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GitHub file fetching | Custom HTTP client | `octokit.repos.getContent` | Already have Octokit, handles auth, rate limiting, types |
| Base64 decoding | Manual implementation | `Buffer.from(str, 'base64')` | Node.js built-in, handles padding correctly |
| Import path resolution | Full module resolution algorithm | `path.resolve(path.dirname(file), importPath)` + extension guessing | Full Node.js module resolution is extremely complex (package.json exports, index.js fallback, etc.); simple dirname+join covers 90% of cases |
| TypeScript AST parsing | Custom parser | Regex for import statements | AST parser would require adding typescript as a runtime dependency (violates 4-dep budget); regex handles static imports reliably |

**Key insight:** The project has a strict 4-dependency budget. Every problem must be solved with existing deps (@octokit/rest, commander, zod, picocolors) or Node.js built-ins.

## Common Pitfalls

### Pitfall 1: Octokit getContent Returns Union Type
**What goes wrong:** TypeScript errors when accessing `data.content` because `repos.getContent` returns a union of file, directory, symlink, and submodule responses.
**Why it happens:** The GitHub API returns different shapes depending on what the path points to. Octokit types reflect all possibilities.
**How to avoid:** Always narrow the type: `if (!Array.isArray(data) && data.type === 'file' && data.content)`.
**Warning signs:** TypeScript error: "Property 'content' does not exist on type..."

### Pitfall 2: Relative Import Resolution Edge Cases
**What goes wrong:** `import { foo } from './utils'` could resolve to `utils.ts`, `utils/index.ts`, `utils.js`, `utils.tsx`, etc.
**Why it happens:** TypeScript/Node.js module resolution is complex -- extensionless imports, index files, package.json exports fields.
**How to avoid:** Try common extensions in order: `.ts`, `.tsx`, `.js`, `.jsx`, then `/index.ts`, `/index.tsx`, `/index.js`. Accept that some imports won't resolve and skip them gracefully.
**Warning signs:** Related files not found despite being clearly imported.

### Pitfall 3: Large Generated Files Eating the Budget
**What goes wrong:** A generated file (schema.ts, types.generated.ts, lock files) gets fetched and consumes the entire character budget.
**Why it happens:** Import parsing finds the import but has no concept of "generated file".
**How to avoid:** Per-file size cap (truncation threshold) combined with code-file-only filter. Skip files over the size limit rather than truncating -- a truncated generated file has zero review value.
**Warning signs:** Total context budget exhausted by 1-2 files.

### Pitfall 4: Base64 Content Has Newlines
**What goes wrong:** GitHub API returns base64 content with line breaks every 60 characters. `Buffer.from(content, 'base64')` handles this correctly in Node.js, but naive base64 decoders may choke.
**Why it happens:** The API formats base64 with MIME-style line breaks.
**How to avoid:** Use `Buffer.from(content, 'base64')` which handles line-broken base64 natively. Do NOT strip newlines manually -- it's unnecessary and error-prone.
**Warning signs:** Garbled file content.

### Pitfall 5: Race Between Fetching Changed Files and Discovering Imports
**What goes wrong:** To parse imports, you need the content of changed files. But changed files are only available as diffs, not full content.
**Why it happens:** `PRData.diff` has the diff, not the full file. Need to fetch full content of changed files first before parsing their imports.
**How to avoid:** Two-round fetch: (1) fetch full content of all changed files from PR head SHA, (2) parse imports from those contents, (3) fetch discovered related files. This is explicitly decided in CONTEXT.md.
**Warning signs:** Import parsing finding no imports because it's running on diff text instead of full file content.

### Pitfall 6: API Rate Limits with Many Files
**What goes wrong:** Fetching N changed files + M related files = N+M API calls. A large PR with 30 changed files could trigger rate limiting.
**Why it happens:** GitHub REST API has rate limits (5000/hour for authenticated users).
**How to avoid:** The 5-file cap on related files limits the second round. For the first round (fetching changed files for import parsing), use `Promise.allSettled` and accept partial results. In practice, PRs rarely have 100+ files and the tool already makes 3 API calls in `fetchPRData`, so the additional calls are well within limits.
**Warning signs:** 403 responses from GitHub API.

## Code Examples

### Fetching File Content from a Specific Ref
```typescript
// Source: GitHub REST API docs (https://docs.github.com/en/rest/repos/contents)
// In github.ts -- new exported function
export async function fetchFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref,
    });
    if (Array.isArray(data) || data.type !== 'file' || !data.content) {
      return null;
    }
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}
```

### Parallel File Fetching with Budget
```typescript
// Fetch multiple files in parallel, respecting size budget
async function fetchRelatedFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  candidates: { path: string; reason: 'import' | 'test' | 'type' | 'barrel' }[],
  maxFiles: number,
  maxFileSize: number,
  maxTotalSize: number,
): Promise<RelatedFile[]> {
  const top = candidates.slice(0, maxFiles);
  const results = await Promise.allSettled(
    top.map(c => fetchFileContent(octokit, owner, repo, c.path, ref))
  );

  const files: RelatedFile[] = [];
  let totalSize = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status !== 'fulfilled' || !result.value) continue;

    let content = result.value;
    if (content.length > maxFileSize) continue; // skip oversized files
    if (totalSize + content.length > maxTotalSize) continue; // budget exceeded

    totalSize += content.length;
    files.push({
      path: top[i].path,
      content,
      reason: top[i].reason,
    });
  }

  return files;
}
```

### Import Extraction Regex
```typescript
// Matches ES module imports and CommonJS require with relative paths
// Captures the path string (group 1)
const RELATIVE_IMPORT_RE = /(?:import\s+(?:[\w*{}\s,]+\s+from\s+)?|require\s*\(\s*)['"](\.[^'"]+)['"]/g;

function extractRelativeImports(source: string): string[] {
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = RELATIVE_IMPORT_RE.exec(source)) !== null) {
    paths.push(m[1]);
  }
  return [...new Set(paths)]; // deduplicate
}
```

### Resolving Import Path to File Path
```typescript
import { dirname, join, extname } from 'node:path';

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

function resolveImportPath(importingFile: string, importPath: string): string[] {
  const dir = dirname(importingFile);
  const resolved = join(dir, importPath);

  // If already has extension, return as-is
  if (extname(resolved)) {
    return [resolved];
  }

  // Try common extensions and index files
  const candidates: string[] = [];
  for (const ext of CODE_EXTENSIONS) {
    candidates.push(resolved + ext);
  }
  for (const ext of CODE_EXTENSIONS) {
    candidates.push(join(resolved, 'index' + ext));
  }
  return candidates;
}
```

### Naming Pattern Inference
```typescript
function inferRelatedByNaming(filePath: string): { path: string; reason: 'test' | 'barrel' }[] {
  const related: { path: string; reason: 'test' | 'barrel' }[] = [];
  const dir = dirname(filePath);
  const base = basename(filePath, extname(filePath));
  const ext = extname(filePath);

  // Test files: foo.test.ts, foo.spec.ts
  for (const suffix of ['.test', '.spec']) {
    related.push({ path: join(dir, base + suffix + ext), reason: 'test' });
  }
  // Also check tests/ directory pattern
  // e.g., src/utils.ts -> tests/utils.test.ts
  const testsDir = filePath.replace(/^src\//, 'tests/');
  if (testsDir !== filePath) {
    for (const suffix of ['.test', '.spec']) {
      related.push({ path: join(dirname(testsDir), base + suffix + ext), reason: 'test' });
    }
  }

  // Barrel file in the same directory
  related.push({ path: join(dir, 'index' + ext), reason: 'barrel' });

  return related;
}
```

### Quick Mode Prompt Injection
```typescript
// In buildPrompt() -- inject related files before the diff
function formatRelatedFiles(files: RelatedFile[]): string {
  if (files.length === 0) return '';
  const blocks = files.map(f =>
    `<related_file path="${f.path}" reason="${f.reason}">\n${f.content}\n</related_file>`
  ).join('\n\n');
  return `\nThe following related files from the codebase provide additional context. Use them to understand how the changed code fits into the larger system:\n\n${blocks}\n`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Diff-only quick review (current) | Diff + related files context | This phase | Quick mode gains cross-file awareness without cloning |
| Unguided "explore the codebase" (current deep mode) | Structured per-file category guidance | This phase | Deep mode explores more systematically, fewer wasted turns |
| No shared context type | ReviewContext data contract | This phase | Clean separation between context gathering and prompt construction |

## Open Questions

1. **Exact per-file size threshold (Claude's Discretion)**
   - What we know: Need to skip/truncate oversized files (generated code, lock files)
   - Recommendation: 50,000 characters (~12,500 tokens). Reasoning: a single related file should not consume more than ~15% of a typical Claude context window. Skip (don't truncate) files over this limit -- a truncated file has less value than a slightly smaller complete file.

2. **Exact total character budget (Claude's Discretion)**
   - What we know: Must cap total related file content to avoid overwhelming the prompt
   - Recommendation: 200,000 characters (~50,000 tokens). The existing diff truncation is at 80,000 characters. 200K for related files + 80K for diff + prompt overhead stays well within Claude's context window (200K tokens for Sonnet).

3. **Regex vs AST for import parsing (Claude's Discretion)**
   - What we know: Regex is simpler, AST requires adding typescript as a runtime dependency
   - Recommendation: **Regex.** The project's 4-dependency budget is non-negotiable. Regex handles `import X from './path'`, `import { X } from './path'`, `import './path'`, and `require('./path')` patterns, which covers 95%+ of real-world usage. Edge cases (dynamic imports, template literals) are acceptable losses for related-file discovery.

4. **Relative import resolution (Claude's Discretion)**
   - Recommendation: Use `path.dirname` + `path.join` + extension guessing (try .ts, .tsx, .js, .jsx, then /index variants). Accept that some imports won't resolve (aliased paths like `@/utils` are common but unresolvable without tsconfig parsing). Skip unresolved imports gracefully.

5. **Deduplication of discovered files (Claude's Discretion)**
   - Recommendation: **Yes, deduplicate.** If a file is found by both import parsing AND naming patterns, keep it once with the higher-priority reason (import > test > type > barrel). Use a Set keyed by file path.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/context.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTX-01 | Deep mode prompt includes structured per-file exploration guidance | unit | `npx vitest run tests/prompt.test.ts -t "exploration guidance"` | Partial (prompt.test.ts exists, tests need adding) |
| CTX-02 | Quick mode discovers + fetches 3-5 related files, injects into prompt | unit | `npx vitest run tests/context.test.ts` | Wave 0 |
| CTX-03 | ReviewContext type in types.ts used by both modes | unit | `npx vitest run tests/context.test.ts -t "ReviewContext"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/context.test.ts tests/prompt.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/context.test.ts` -- covers CTX-02, CTX-03 (import parsing, naming patterns, file fetching, budget enforcement, deduplication)
- [ ] New tests in `tests/prompt.test.ts` -- covers CTX-01 (structured exploration guidance in deep mode prompt)
- [ ] New tests in `tests/github.test.ts` -- covers `fetchFileContent()` with mock Octokit

## Sources

### Primary (HIGH confidence)
- @octokit/rest v22.0.1 -- installed in project, verified API surface
- GitHub REST API docs (https://docs.github.com/en/rest/repos/contents) -- repos.getContent endpoint parameters, response structure, size limits, ref parameter
- Existing codebase (src/github.ts, src/prompt.ts, src/types.ts, src/cli.ts) -- current architecture, patterns, integration points

### Secondary (MEDIUM confidence)
- Octokit TypeScript type narrowing (https://github.com/octokit/types.ts/issues/440, https://github.com/octokit/types.ts/issues/267) -- verified workaround for union type on getContent response
- ES module import regex patterns (https://gist.github.com/manekinekko/7e58a17bc62a9be47172) -- community-validated regex for ES6 import extraction

### Tertiary (LOW confidence)
- None -- all findings verified with official sources or existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- using only existing dependencies and Node.js built-ins, all verified in codebase
- Architecture: HIGH -- follows established patterns in the existing codebase (parallel API calls, type narrowing, verbose debug output)
- Pitfalls: HIGH -- Octokit type narrowing issue verified via multiple GitHub issues; import resolution complexity well-documented
- Import parsing regex: MEDIUM -- regex covers common patterns but edge cases exist (aliased paths, dynamic imports); acceptable for discovery use case

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable -- Octokit REST API and TypeScript import syntax are mature)

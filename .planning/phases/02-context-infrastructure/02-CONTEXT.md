# Phase 2: Context Infrastructure - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Both review modes can gather structured codebase context before prompt construction. Quick mode fetches related files via the Octokit contents API. Deep mode prompt is updated with structured guidance on which adjacent files to explore. A shared ReviewContext type serves as the data contract. Covers CTX-01, CTX-02, CTX-03.

</domain>

<decisions>
## Implementation Decisions

### Related file discovery
- Combine import parsing AND naming pattern inference to identify related files
- Parse imports from full file content of changed files (fetch each changed file via Octokit contents API, then extract imports)
- Naming patterns to recognize: test files (foo.test.ts, foo.spec.ts), type/interface files imported by changed files, index.ts/barrel files in the same directory
- Discovery runs for quick mode only -- deep mode already has the cloned repo and gets category-based guidance instead
- TypeScript/JavaScript import parsing only for now; other languages fall back to naming pattern inference only

### Quick mode context fetching
- Fetch related files from the PR head branch (head SHA) -- shows the state as the PR author sees it
- Skip files that are already in the diff (already visible to Claude) -- use the file budget for files NOT in the diff
- Full file content in `<related_file path="...">` XML tags in the prompt
- Context gathering always on by default -- no opt-in flag needed (quality improvement, minimal latency via parallel API calls)
- Prioritization when 5-file cap forces choices: imports first, then tests, then type definitions

### Deep mode prompt guidance
- Replace the current unguided "Codebase Exploration" section with structured category guidance
- Guide Claude on WHAT to look for by category: for each changed file, find and read its callers, its test file, its type definitions
- Claude finds the actual files itself (has full repo access) -- don't compute a named file list

### Budget and size limits
- Maximum 5 related files fetched for quick mode (matches CTX-02 "3-5 related files")
- Per-file size limit: truncate large files (skip or truncate files over threshold to prevent generated files, lock files, and large configs from blowing up the prompt)
- Total context size budget: cap total related file content (character limit) to ensure context + diff together don't overwhelm the prompt window
- Stick to code files only -- no config files (package.json, tsconfig.json) in the related file budget

### Error handling
- File fetch failures (not found, API errors) are skipped silently -- log in verbose mode only
- Context is best-effort enrichment; review proceeds with whatever context was gathered

### Verbose output
- Show context gathering stats in verbose mode: `[debug] Context: 4 related files fetched (2 imports, 1 test, 1 types)` -- follows existing verbose pattern

### ReviewContext type design
- Shared ReviewContext type in types.ts with mode-specific optional fields
- Quick mode populates relatedFiles (fetched file contents)
- Deep mode populates explorationGuidance (structured category list for the prompt)
- Serves as the shared data contract consumed by both quick and deep mode prompt construction (CTX-03)

### Claude's Discretion
- Exact per-file size threshold for truncation
- Exact total character budget for combined related file content
- Import parsing implementation details (regex vs AST)
- Specific wording of deep mode category guidance prompt text
- How to resolve relative imports to actual filenames
- Whether to deduplicate related files discovered by both import parsing and naming patterns

</decisions>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PRData.files` (types.ts): Already has the list of changed files with filenames -- use as input for related file discovery
- `PRData.headSha` (types.ts): Head SHA for fetching file contents from the correct branch ref
- `fetchPRData()` (github.ts): Already uses parallel `Promise.all` for API calls -- context fetching can follow same pattern
- `truncateDiff()` (prompt.ts): Existing truncation logic for diffs -- similar approach can be used for per-file content truncation
- `printDebug()` (output.ts): Existing `[debug]` prefix pattern for verbose output
- `FINDING_FORMAT_INSTRUCTIONS` / `JSON_RESPONSE_INSTRUCTION` (prompt.ts): Shared prompt fragments extracted to prevent drift -- ReviewContext prompt fragments should follow same pattern

### Established Patterns
- Octokit is instantiated once in github.ts and passed to functions -- new context-fetching functions should accept an Octokit instance parameter
- All types are in types.ts, Zod schemas in schemas.ts -- ReviewContext goes in types.ts (no Zod needed for internal types)
- Pipeline flows through cli.ts: fetch PR data -> build prompt -> analyze -- context gathering fits between fetch and build
- Verbose output follows `[debug] Label: value` format on one line

### Integration Points
- `buildPrompt()` in prompt.ts -- needs to accept ReviewContext and include related files in XML tags
- `buildAgenticPrompt()` in prompt.ts -- needs to accept ReviewContext and replace Codebase Exploration section with structured guidance
- `cli.ts` pipeline -- context gathering step between fetchPRData() and buildPrompt()/buildAgenticPrompt()
- `github.ts` -- new function(s) to fetch file contents via Octokit repos.getContent API

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 02-context-infrastructure*
*Context gathered: 2026-03-04*

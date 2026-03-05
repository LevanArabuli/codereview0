# Codebase Concerns

**Analysis Date:** 2026-03-05

## Tech Debt

**Large diff truncation silently reduces review quality:**
- Issue: Diffs larger than 80,000 characters are truncated at file boundaries with a warning message. Large PRs may have significant portions of the diff omitted from the review without explicit user notification in the CLI output.
- Files: `src/prompt.ts` (lines 9-25)
- Impact: Claude's review is incomplete for large diffs. Users may believe they received a full review when only ~80KB was analyzed. No interactive prompt or failover to deep mode guidance.
- Fix approach: Add explicit warning message to CLI output when truncation occurs. Consider raising the limit or implementing adaptive sizing based on model context window. For agentic reviews, consider that the full codebase is available via exploration tools regardless of diff size.

**Agentic review max-turns limit could mask incomplete analysis:**
- Issue: Agentic review is capped at 75 turns (hardcoded `MAX_AGENTIC_TURNS`), with a 10-minute wall-clock timeout. Complex codebases may require more turns to complete thorough cross-file analysis.
- Files: `src/analyzer.ts` (lines 25-26, 269, 331)
- Impact: Deep reviews may terminate before Claude completes cross-file exploration, reporting "max turns reached" as a non-error condition rather than incomplete analysis.
- Fix approach: Expose `--max-turns` as a CLI flag. Log how many turns were consumed vs. the limit so users can understand if a review completed fully. Consider increasing default based on codebase size metrics.

**File listing pagination not implemented:**
- Issue: `octokit.pulls.listFiles()` requests 100 files per page but does not paginate. PRs with >100 changed files will miss files in the review.
- Files: `src/github.ts` (lines 45-50)
- Impact: Large refactors or monorepo PRs may have >100 changed files. The review will skip files beyond the first 100.
- Fix approach: Implement pagination loop using `octokit.paginate()` to fetch all files. Test with large PR fixture (>100 files).

**JSON parsing falls back to regex extraction without validation:**
- Issue: If Claude CLI response fails direct JSON parsing, the code attempts regex extraction: `resultText.match(/\{[\s\S]*"findings"[\s\S]*\}/)`. This regex is overly greedy and could extract invalid JSON from malformed responses.
- Files: `src/analyzer.ts` (lines 111-121)
- Impact: Malformed Claude output could be partially extracted and passed to Zod validation, leading to obscure validation errors instead of clear "response parsing failed" messages.
- Fix approach: Validate extracted JSON before Zod parsing. Add explicit check that JSON has valid structure before attempting parse. Consider adding line-number tracking to Claude output for better error messages.

**Promise race condition in agentic review stream handling:**
- Issue: The `analyzeAgentic()` function uses manual `setTimeout` for timeout because `spawn()` doesn't support the `timeout` option. The `settled` flag prevents race conditions, but stdout/stderr are accumulated without bounds checking.
- Files: `src/analyzer.ts` (lines 275-361)
- Impact: If Claude CLI produces very large stream output (unlikely but possible with `--verbose`), the accumulated `stdout` and `stderr` strings could consume significant memory. No explicit buffer limits like the `maxBuffer` used in `analyzeDiff()`.
- Fix approach: Add accumulated buffer limits for stream-based analysis. Use `child.stdout.pause()` / `child.stdin.pause()` if buffers exceed thresholds, or emit a warning.

## Known Bugs

**HTML report file paths contain special characters without validation:**
- Issue: HTML report paths are generated using `prData.headRepoName` directly in the filename without sanitization. Characters like `<`, `>`, `:` (valid in some OS filenames but problematic) could cause file write failures.
- Files: `src/html-report.ts` (lines ~120-150, not fully read)
- Impact: Repository names with special characters may cause the report generation to fail silently.
- Workaround: Currently not handled; report generation will fail at write time.

**Cleanup prompt may hang on TTY unavailability:**
- Issue: `promptCleanup()` uses `readline.createInterface()` with `process.stdin` / `process.stdout`. In non-TTY environments (CI/pipes), this may hang indefinitely waiting for input.
- Files: `src/cloner.ts` (lines 130-148)
- Impact: Deep review in CI pipelines could hang at cleanup prompt if run without `--post`. User must Ctrl+C to exit.
- Fix approach: Detect TTY availability with `process.stdin.isTTY` before prompting. In non-TTY, default to cleanup without prompting. Add `--no-cleanup-prompt` flag.

## Security Considerations

**Environment variable filtering uses blocklist (not allowlist):**
- Issue: `filterEnv()` strips known-dangerous prefixes (`AWS_`, `GCP_`, `SECRET_`, etc.) and exact matches (`DATABASE_URL`). Novel environment variables containing credentials (e.g., `CUSTOM_API_SECRET`, `INTERNAL_DB_URL`) would NOT be filtered.
- Files: `src/analyzer.ts` (lines 28-60)
- Impact: Custom env var naming conventions outside the blocklist could leak credentials to the Claude CLI subprocess.
- Current mitigation: The allowlist (`KEEP_LIST`) includes only essential vars (`ANTHROPIC_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`). This is defense-in-depth: even leaked custom env vars are unlikely to grant code execution.
- Recommendation: Document this limitation in SECURITY.md. Consider periodically auditing for new credential patterns. If possible, explore Claude CLI's environment filtering capabilities.

**Prompt injection via PR metadata (title/body) not escaped in prompt:**
- Issue: PR title and description are inserted into the prompt text without any escaping or prefix/suffix markers beyond XML tags. A malicious PR author could craft a title like `</pr_metadata>\n\nIGNORE previous instructions...` to break out of the XML context.
- Files: `src/prompt.ts` (lines 95-98, 149-152)
- Impact: Accepted risk per SECURITY.md (Prompt Injection section). The PR diff IS the content being reviewed, so filtering would degrade analysis. Mitigations in place: structural push prevention (remote removed), prompt guardrails, PENDING review status.
- Recommendation: This is correctly identified as an accepted risk. Monitor Claude CLI for improved prompt injection resistance and consider structured prompt APIs if they become available.

**Regex for secret detection may have false positives/negatives:**
- Issue: `scrubSecrets()` uses regex patterns to detect GitHub tokens, API keys, and Bearer auth. The patterns are heuristic and may miss novel token formats or fail to redact legitimate content containing token-like strings.
- Files: `src/errors.ts` (lines 18-29)
- Impact: Low risk of leaking credentials in edge cases. Legitimate code snippets in error messages might be incorrectly redacted.
- Current mitigation: Patterns are conservative and focus on well-known formats (GitHub classic tokens `ghp_*`, fine-grained PATs `github_pat_*`, Anthropic keys `sk-ant-*`).
- Recommendation: Periodically update patterns as new token formats are introduced. Consider adding integration with secret scanning tools.

## Performance Bottlenecks

**Clone timeout (5 minutes) may be insufficient for large enterprise repos:**
- Issue: Repository cloning uses `--depth 1` (single-commit shallow clone) with a 5-minute timeout. Enterprise repositories with large binary artifacts or complex histories may exceed this window.
- Files: `src/cloner.ts` (lines 10-11, 111)
- Impact: Cloning fails for repos >~500MB, forcing fallback to quick review. Users don't see which repos are too large; they see a generic "Could not clone repo" warning.
- Fix approach: Make clone timeout configurable via `--clone-timeout` flag. Add explicit size checking pre-clone via `gh repo view --json diskUsage`. Log why clone failed with actionable guidance.

**Analysis output accumulation without streaming (quick mode):**
- Issue: `analyzeDiff()` waits for the entire Claude CLI process to complete before returning. For verbose analyses (e.g., with `--detailed` mode), the output is buffered entirely in memory before parsing.
- Files: `src/analyzer.ts` (lines 153-220)
- Impact: Large analyses (near the 10MB `MAX_BUFFER` limit) will stall the CLI until the process completes. No user feedback during analysis (unlike agentic mode which streams stderr).
- Fix approach: Consider streaming JSON results in quick mode as well (requires Claude CLI to support `stream-json` without `--verbose`). Alternatively, add periodic "still analyzing..." progress messages via stderr.

**HTML report diff rendering loads entire diff into memory:**
- Issue: `parseDetailedDiff()` parses the entire unified diff and builds an in-memory representation (array of DiffFile/DiffLine). Large diffs (near truncation limit) are rendered entirely.
- Files: `src/html-diff-parser.ts`, `src/html-report.ts`
- Impact: On systems with memory constraints, rendering a 80KB diff could be slow. No streaming or chunked rendering.
- Fix approach: For large reports, implement lazy rendering or paginated diff display in the HTML (JavaScript-based pagination).

## Fragile Areas

**Diff parsing line number extraction is fragile:**
- Issue: `parseDiffHunks()` relies on regex extraction of hunk headers (`@@ -oldStart[,oldCount] +newStart[,newCount] @@`). If the unified diff format deviates from standard (e.g., binary files, renames, mode changes), line numbers may be incorrect or parsing may skip hunks.
- Files: `src/diff-parser.ts` (lines 3-36)
- Why fragile: The regex assumes numeric line numbers and optional counts. Edge cases like merge commits, submodule diffs, or git attributes may not parse correctly.
- Safe modification: Add comprehensive test fixtures for edge-case diffs (binary files, renames, mode-only changes). Add explicit error logging when hunk parsing fails.
- Test coverage: `diff-parser.test.ts` should include fixtures for renamed files, permission-only changes, and binary diffs.

**GitHub inline comment positioning assumes diff format stability:**
- Issue: `isLineInDiff()` validates that a finding's line falls within a hunk. The hunk boundaries are derived from unified diff parsing. If GitHub's diff representation changes or if the Claude response references lines outside the PR's changed diff, the comment will be categorized as "off-diff" and moved to the review body.
- Files: `src/diff-parser.ts`, `src/review-builder.ts`
- Why fragile: GitHub API can return diff content in different formats depending on viewing options (full context, whitespace changes, etc.). Changes in how GitHub computes diffs could silently break line mapping.
- Safe modification: Add logging for findings that reference lines not present in the diff. Add validation that Claude's reported line numbers align with actual hunk boundaries.
- Test coverage: Gaps in testing for renamed files and binary changes in diffs.

**Review mode overlays could be bypassed by prompt injection:**
- Issue: Mode overlays (strict, detailed, lenient, balanced) are string concatenations to the prompt. A carefully crafted PR description could override the mode by including conflicting instructions.
- Files: `src/prompt.ts` (lines 27-45, 115-118, 194-195)
- Impact: Low risk; a user choosing `--mode strict` shouldn't be overridden by a PR author. However, the current prompt structure doesn't make the mode override clear.
- Fix approach: Wrap mode overlays in explicit delimiter markers (e.g., `<!-- BEGIN MODE OVERRIDE -->`). Add a system-level instruction that mode directives are non-negotiable.

**Zod schema parsing may silently drop findings with optional fields missing:**
- Issue: The `ReviewResultSchema` uses optional fields (`endLine`, `suggestedFix`, `relatedLocations`). If Claude's JSON includes invalid values (e.g., `line: "not a number"`), Zod will coerce or reject the entire finding depending on configuration.
- Files: `src/schemas.ts`
- Why fragile: Without seeing the schema implementation, it's unclear if Zod coerces string line numbers to integers, or if invalid findings cause parse failure.
- Safe modification: Review `schemas.ts` and ensure strict validation (no type coercion). Add explicit error logging showing which fields were rejected.
- Test coverage: Add fixtures with malformed findings (string line numbers, negative confidence, unknown severity).

## Scaling Limits

**Fixed buffer size for Claude CLI output (10MB):**
- Issue: `analyzeDiff()` sets `maxBuffer: 10 * 1024 * 1024` (10MB). If Claude's response (including the JSON wrapper and verbose output) exceeds 10MB, the process will error with "ERR_CHILD_PROCESS_STDIO_MAXBUFFER".
- Files: `src/analyzer.ts` (lines 14-15, 176)
- Current capacity: 10MB total output (covers most PRs; typical response is 10-100KB)
- Limit: Exceeding 10MB crashes the analysis with no fallback
- Scaling path: Make buffer size configurable via env var (`CODEREVIEW_MAX_BUFFER`). Implement streaming response parsing to avoid buffering the entire response.

**PR file list limited to 100 files (GitHub API default):**
- Issue: `fetchPRData()` requests only 100 files. Large PRs with >100 changed files will have omitted files in the review metadata.
- Files: `src/github.ts` (lines 45-50)
- Current capacity: 100 files per request
- Limit: PRs with >100 changes skip remaining files
- Scaling path: Implement pagination with `octokit.paginate()` to fetch all files.

**Agentic exploration has no file count limits:**
- Issue: The agentic prompt tells Claude "Exploration is unlimited -- there are no artificial limits on how many files you read." However, the Claude CLI's `--max-turns` limit (75 by default) may prevent deep exploration in very large codebases.
- Files: `src/prompt.ts` (lines 184)
- Impact: In large monorepos, agentic review may terminate before exploring all relevant cross-file impacts.
- Scaling path: Monitor turn consumption and provide guidance to users (log "Used 75/75 turns; explore depth reached"). Consider exposing `--max-turns` as a CLI flag.

**Concurrent clone operations not protected:**
- Issue: If multiple `codereview` processes run simultaneously with the same repo, they may race to create/remove the `.codereview/<repoName>` directory, causing cleanup conflicts.
- Files: `src/cloner.ts` (lines 88-98), `src/cli.ts` (lines 19-27)
- Impact: Rare in practice (user running tool twice manually), but possible in CI pipelines. Could result in orphaned directories or file access errors.
- Scaling path: Use a per-repo lock file or UUID subdirectories (`.codereview/<repoName>-<uuid>`) to allow concurrent clones of the same repo.

## Dependencies at Risk

**Minimal dependency footprint is intentional but creates upgrade pressure:**
- Risk: The project explicitly keeps dependencies to 4 runtime packages (commander, @octokit/rest, zod, picocolors). This is a design choice to minimize supply-chain risk, but each dependency is critical.
- Files: `package.json` (lines 23-28)
- Impact: If any of these packages is abandoned or has a breaking change, the tool must adapt or break.
- Current status: All 4 packages are actively maintained (as of 2026-03-05).
- Migration plan: Monitor npm advisories. For @octokit/rest, have a migration plan to a lighter REST client if Octokit becomes too heavyweight. For Zod, no stable alternative; tool depends on active Zod development.

**Anthropic/Claude CLI dependency is external and not vendored:**
- Risk: The tool calls `claude` as a subprocess. If the Claude CLI is unavailable, deprecated, or changes output format, the tool breaks.
- Files: `src/analyzer.ts`, `src/prerequisites.ts`
- Impact: Major version changes in Claude CLI could introduce breaking changes to JSON output format, max-turns behavior, or tool availability.
- Current mitigation: Prerequisites check ensures Claude CLI exists before analysis. Output parsing is defensive (double JSON parse with regex fallback). Support for both v1.x (`cost_usd`) and v2.x (`total_cost_usd`) metadata formats.
- Migration plan: Monitor Claude CLI release notes. Implement version detection and output format switching if needed.

## Missing Critical Features

**No dry-run or preview mode:**
- Problem: Users cannot see what findings would be posted to GitHub without actually posting. The `--post` flag directly submits a PENDING review.
- Blocks: Quality assurance; users may want to review findings locally before submitting to GitHub.
- Fix approach: Add `--dry-run` flag that runs analysis and displays findings without posting to GitHub. Show the exact review body and inline comments that would be posted.

**No filtering or sorting of findings before GitHub posting:**
- Problem: All findings from the analysis are included in the GitHub review. Users cannot exclude low-confidence findings, nitpicks, or specific severity levels.
- Blocks: Fine-grained control over which findings to share with the team.
- Fix approach: Add `--min-confidence <high|medium|low>` and `--exclude-severity <severity>` flags. Show a summary before posting.

**No caching or incremental analysis for repeated reviews:**
- Problem: Running `codereview` twice on the same PR performs full analysis both times. No caching of Claude responses or findings.
- Blocks: Cost optimization and speed for iterative reviews (e.g., user updates PR, runs review again).
- Fix approach: Implement optional caching keyed by PR head SHA and review mode. Cache findings for 1 hour. Add `--no-cache` flag to force fresh analysis.

## Test Coverage Gaps

**Agentic review stream parsing not tested:**
- What's not tested: The `parseStreamResult()` function that extracts the final `result` event from newline-delimited JSON output.
- Files: `src/analyzer.ts` (lines 230-242)
- Risk: If Claude CLI's stream format changes (e.g., event ordering, field names), parsing could silently fail or return incomplete results. No test fixtures for stream output.
- Priority: High -- this is critical path for deep reviews.

**No end-to-end integration tests:**
- What's not tested: Full workflow from URL parsing -> GitHub fetch -> analysis -> review posting. Each module is unit-tested, but interactions are not.
- Files: All orchestration in `src/cli.ts` (not covered by tests)
- Risk: Integration failures (e.g., GitHub API version mismatch, Claude CLI output format change) would only be caught in production.
- Priority: Medium -- would require live GitHub/Claude access; consider fixture-based e2e tests.

**HTML report generation edge cases not covered:**
- What's not tested: Rendering of diffs with binary files, renames, mode-only changes. Rendering of findings with very long descriptions or many related locations.
- Files: `src/html-report.ts`, `src/html-diff-parser.ts`
- Risk: Large or unusual diffs could produce malformed HTML or crash the renderer.
- Priority: Medium -- test with complex diffs (merge commits, submodule changes, file renames).

**Error handling in GitHub API fallback not tested:**
- What's not tested: The 422 error fallback in `postReview()` (lines 121-145). If GitHub rejects inline comments due to invalid positions, the code falls back to posting all findings in the review body.
- Files: `src/github.ts` (lines 98-147)
- Risk: Fallback code path may have bugs (e.g., incorrect body formatting, missing findings).
- Priority: Low -- fallback is defensive; but should be tested with a fixture that triggers 422 errors.

**Diff truncation warning not validated:**
- What's not tested: The behavior when a diff exceeds 80KB and is truncated. No test verifies that the truncation warning is present or that findings for truncated files are correctly attributed.
- Files: `src/prompt.ts` (lines 16-25)
- Risk: If truncation logic breaks, large diffs could silently be analyzed incompletely.
- Priority: Medium -- add fixture with 100KB diff to verify truncation.

---

*Concerns audit: 2026-03-05*

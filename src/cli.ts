import { Command } from 'commander';
import pc from 'picocolors';
import { parsePRUrl } from './url-parser.js';
import { checkPrerequisites } from './prerequisites.js';
import { createOctokit, fetchPRData, postReview } from './github.js';
import { printPRSummary, printErrors, printVerbose, printProgress, printProgressDone, printAnalysisSummary, printFindings, printExplorationSummary } from './output.js';
import { analyzeDiff, analyzeDeep } from './analyzer.js';
import { cloneRepo, getClonePath, promptCleanup } from './cloner.js';
import { parseDiffHunks } from './diff-parser.js';
import { partitionFindings, buildReviewBody } from './review-builder.js';
import { formatInlineComment } from './formatter.js';
import { EXIT_PREREQ, EXIT_INVALID_URL, EXIT_API_ERROR, EXIT_ANALYSIS_ERROR } from './errors.js';

const program = new Command();

program
  .name('codereview')
  .description('AI-powered GitHub PR code review')
  .version('0.1.0')
  .argument('<pr-url>', 'GitHub Pull Request URL')
  .option('-v, --verbose', 'Show debug info including raw diff')
  .option('--quick', 'Quick review: analyze diff only (default)')
  .option('--deep', 'Deep review: clone repo and explore codebase for cross-file impacts')
  .option('--post', 'Post review to GitHub PR')
  .option('--model <model-id>', 'Claude model to use (e.g., sonnet, opus, haiku, or full model ID)')
  .action(async (prUrl: string, options: { verbose?: boolean; quick?: boolean; deep?: boolean; post?: boolean; model?: string }) => {
    // 1. Check prerequisites (collect all failures, report at once)
    const failures = checkPrerequisites();
    if (failures.length > 0) {
      printErrors(failures);
      process.exit(EXIT_PREREQ);
    }

    // 2. Parse PR URL
    const parsed = parsePRUrl(prUrl);
    if (!parsed) {
      console.error(pc.red('\u2716 Invalid PR URL: ' + prUrl));
      console.error(pc.dim('  Expected: https://github.com/owner/repo/pull/123'));
      process.exit(EXIT_INVALID_URL);
    }

    // 3. Fetch PR data with progress
    let prData;
    const octokit = createOctokit();
    try {
      printProgress('Fetching PR data...');
      prData = await fetchPRData(octokit, parsed.owner, parsed.repo, parsed.prNumber);
      printProgressDone();
    } catch (error: unknown) {
      console.log(); // newline after progress message
      console.error(pc.red('\u2716 Failed to fetch PR data'));
      if (error instanceof Error && error.message) {
        console.error(pc.dim('  ' + error.message));
      }
      process.exit(EXIT_API_ERROR);
    }

    // Print PR summary so user sees what they're reviewing while waiting for analysis
    printPRSummary(prData);

    // Severity sort order for merging findings
    const SEVERITY_ORDER: Record<string, number> = { bug: 0, security: 1, suggestion: 2, nitpick: 3 };

    let findings;

    if (options.deep) {
      // Deep mode: clone -> quick analysis -> deep exploration -> merge findings

      // 4a. Clone repository
      let cloneSucceeded = false;
      const clonePath = getClonePath(prData.headRepoName);
      try {
        printProgress('Cloning repository...');
        await cloneRepo(prData.headRepoOwner, prData.headRepoName, prData.headBranch, clonePath);
        printProgressDone();
        cloneSucceeded = true;
      } catch (error: unknown) {
        console.log(); // newline after progress message
        console.error(pc.yellow('Warning: Could not clone repo -- falling back to quick review'));
        if (error instanceof Error && error.message) {
          console.error(pc.dim('  ' + error.message));
        }
      }

      // 4b. Quick analysis (always runs)
      let quickFindings;
      try {
        printProgress('Analyzing diff...');
        const result = await analyzeDiff(prData, options.model);
        printProgressDone();
        quickFindings = result.findings;
      } catch (error: unknown) {
        console.log(); // newline after progress message
        console.error(pc.red('Analysis failed'));
        if (error instanceof Error && error.message) {
          console.error(error.message);
        }
        process.exit(EXIT_ANALYSIS_ERROR);
      }

      // 4c. Deep exploration (only if clone succeeded)
      let deepFindings: typeof quickFindings = [];
      if (cloneSucceeded) {
        printProgress('Exploring codebase...');
        const deepResult = await analyzeDeep(prData, clonePath, options.model);
        printProgressDone();
        deepFindings = deepResult.findings;
        if (deepFindings.length > 0) {
          printExplorationSummary(deepFindings.length);
        }
      }

      // 4d. Merge findings sorted by severity, then by file
      findings = [...quickFindings, ...deepFindings].sort((a, b) => {
        const sa = SEVERITY_ORDER[a.severity] ?? 9;
        const sb = SEVERITY_ORDER[b.severity] ?? 9;
        return sa !== sb ? sa - sb : a.file.localeCompare(b.file);
      });

      // 5. Terminal output (always shown)
      printAnalysisSummary(findings);
      printFindings(findings);

      // 6. Verbose output
      if (options.verbose) {
        printVerbose(prData);
      }

      // 7. Post review to GitHub (only with --post and non-zero findings)
      if (options.post && findings.length > 0) {
        try {
          printProgress('Posting review to GitHub...');

          const diffHunks = parseDiffHunks(prData.diff);
          const { inline, offDiff } = partitionFindings(findings, diffHunks);
          const reviewBody = buildReviewBody(findings, offDiff);
          const comments = inline.map((f) => ({
            path: f.file,
            line: f.line,
            side: 'RIGHT' as const,
            body: formatInlineComment(f),
          }));

          const reviewUrl = await postReview(
            octokit,
            parsed.owner,
            parsed.repo,
            parsed.prNumber,
            prData.headSha,
            reviewBody,
            comments,
          );

          printProgressDone();
          console.log(pc.dim('Review URL: ') + reviewUrl);
        } catch (error: unknown) {
          console.log(); // newline after progress message
          console.error(pc.yellow('\u26A0 Failed to post review to GitHub'));
          if (error instanceof Error && error.message) {
            console.error(pc.dim('  ' + error.message));
          }
        }
      }

      // 8. Cleanup cloned repo (only if clone succeeded)
      if (cloneSucceeded) {
        try {
          await promptCleanup(clonePath);
        } catch {
          // Cleanup failure should never crash the tool
        }
      }
    } else {
      // Quick mode (default): analyze diff only

      // 4. Analyze diff with progress
      try {
        printProgress('Analyzing diff...');
        const result = await analyzeDiff(prData, options.model);
        printProgressDone();
        findings = result.findings;
      } catch (error: unknown) {
        console.log(); // newline after progress message
        console.error(pc.red('Analysis failed'));
        if (error instanceof Error && error.message) {
          console.error(error.message);
        }
        process.exit(EXIT_ANALYSIS_ERROR);
      }

      // 5. Terminal output (always shown)
      printAnalysisSummary(findings);
      printFindings(findings);

      // 6. Verbose output
      if (options.verbose) {
        printVerbose(prData);
      }

      // 7. Post review to GitHub (only with --post and non-zero findings)
      if (options.post && findings.length > 0) {
        try {
          printProgress('Posting review to GitHub...');

          const diffHunks = parseDiffHunks(prData.diff);
          const { inline, offDiff } = partitionFindings(findings, diffHunks);
          const reviewBody = buildReviewBody(findings, offDiff);
          const comments = inline.map((f) => ({
            path: f.file,
            line: f.line,
            side: 'RIGHT' as const,
            body: formatInlineComment(f),
          }));

          const reviewUrl = await postReview(
            octokit,
            parsed.owner,
            parsed.repo,
            parsed.prNumber,
            prData.headSha,
            reviewBody,
            comments,
          );

          printProgressDone();
          console.log(pc.dim('Review URL: ') + reviewUrl);
        } catch (error: unknown) {
          console.log(); // newline after progress message
          console.error(pc.yellow('\u26A0 Failed to post review to GitHub'));
          if (error instanceof Error && error.message) {
            console.error(pc.dim('  ' + error.message));
          }
        }
      }
    }
  });

program.parse();

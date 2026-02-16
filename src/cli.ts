import { Command, Option } from 'commander';
import pc from 'picocolors';
import { parsePRUrl } from './url-parser.js';
import { checkPrerequisites } from './prerequisites.js';
import { createOctokit, fetchPRData, postReview } from './github.js';
import { printPRSummary, printErrors, printDebug, printModel, printMode, formatDuration, estimateTokens, printProgress, printProgressDone, printAnalysisSummary, printFindings, printExplorationSummary } from './output.js';
import { buildPrompt, buildDeepPrompt, type ReviewMode } from './prompt.js';
import { analyzeDiff, analyzeDeep } from './analyzer.js';
import { cloneRepo, getClonePath, promptCleanup } from './cloner.js';
import { parseDiffHunks } from './diff-parser.js';
import { partitionFindings, buildReviewBody } from './review-builder.js';
import { formatInlineComment } from './formatter.js';
import { EXIT_PREREQ, EXIT_INVALID_URL, EXIT_API_ERROR, EXIT_ANALYSIS_ERROR } from './errors.js';
import { generateHtmlReport, openInBrowser } from './html-report.js';

const program = new Command();

program
  .name('codereview')
  .description('AI-powered GitHub PR code review')
  .version('0.1.0')
  .argument('<pr-url>', 'GitHub Pull Request URL')
  .option('--verbose', 'Show debug info: model, timing, prompt size, finding counts')
  .option('--quick', 'Quick review: analyze diff only (default)')
  .option('--deep', 'Deep review: clone repo and explore codebase for cross-file impacts')
  .option('--post', 'Post review to GitHub PR')
  .option('--html', 'Generate HTML report and open in browser')
  .option('--model <model-id>', 'Claude model to use (e.g., sonnet, opus, haiku, or full model ID)')
  .addOption(
    new Option('--mode <mode>', 'Review mode: strict, detailed, lenient, balanced')
      .choices(['strict', 'detailed', 'lenient', 'balanced'])
      .default('balanced')
  )
  .action(async (prUrl: string, options: { verbose?: boolean; quick?: boolean; deep?: boolean; post?: boolean; html?: boolean; model?: string; mode: ReviewMode }) => {
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

    // 3. Fetch PR data with progress and timing
    let prData;
    const octokit = createOctokit();
    const fetchStart = performance.now();
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
    const fetchDuration = performance.now() - fetchStart;
    if (options.verbose) {
      printDebug(`Fetch: ${formatDuration(fetchDuration)}`);
    }

    // Print PR summary so user sees what they're reviewing while waiting for analysis
    printPRSummary(prData);
    printMode(options.mode);
    if (options.verbose) {
      printDebug(`Mode: ${options.mode}`);
    }

    let findings;

    if (options.deep) {
      // Deep mode: clone -> quick analysis -> deep exploration -> merge findings

      // 4a. Clone repository
      let cloneSucceeded = false;
      const clonePath = getClonePath(prData.headRepoName);
      const cloneStart = performance.now();
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
      const cloneDuration = performance.now() - cloneStart;
      if (options.verbose) {
        printDebug(`Clone: ${formatDuration(cloneDuration)}`);
      }

      // 4b. Quick analysis (always runs)
      let quickFindings;
      let diffModel = '';
      const diffPrompt = buildPrompt(prData, options.mode);
      const analyzeStart = performance.now();
      try {
        printProgress('Analyzing diff...');
        const result = await analyzeDiff(prData, options.model, options.mode);
        printProgressDone();
        quickFindings = result.findings;
        diffModel = result.model;
      } catch (error: unknown) {
        console.log(); // newline after progress message
        console.error(pc.red('Analysis failed'));
        if (error instanceof Error && error.message) {
          console.error(error.message);
        }
        process.exit(EXIT_ANALYSIS_ERROR);
      }
      const analyzeDuration = performance.now() - analyzeStart;

      // Model line always visible after first analysis
      printModel(diffModel);

      if (options.verbose) {
        printDebug(`Analyze (diff): ${formatDuration(analyzeDuration)}, prompt ${estimateTokens(diffPrompt.length)}`);
      }

      // 4c. Deep exploration (only if clone succeeded)
      let deepFindings: typeof quickFindings = [];
      if (cloneSucceeded) {
        const deepPrompt = buildDeepPrompt(prData, options.mode);
        const exploreStart = performance.now();
        printProgress('Exploring codebase...');
        const deepResult = await analyzeDeep(prData, clonePath, options.model, options.mode);
        printProgressDone();
        deepFindings = deepResult.findings;
        const exploreDuration = performance.now() - exploreStart;
        if (deepFindings.length > 0) {
          printExplorationSummary(deepFindings.length);
        }
        if (options.verbose) {
          printDebug(`Analyze (explore): ${formatDuration(exploreDuration)}, prompt ${estimateTokens(deepPrompt.length)}`);
        }
      }

      // 4d. Merge findings (printFindings owns sorting)
      findings = [...quickFindings, ...deepFindings];

      // 5. Terminal output (always shown)
      printAnalysisSummary(findings);
      printFindings(findings);

      // Generate HTML report (if requested)
      if (options.html) {
        const reportFile = generateHtmlReport(prData, findings, parsed);
        openInBrowser(reportFile);
      }

      // 6. Finding counts debug
      if (options.verbose) {
        if (options.post) {
          const diffHunks = parseDiffHunks(prData.diff);
          const { inline, offDiff } = partitionFindings(findings, diffHunks);
          const posted = inline.length + (offDiff.length > 0 ? 1 : 0);
          printDebug(`Findings: ${findings.length} raw, ${posted} posted`);
        } else {
          printDebug(`Findings: ${findings.length} raw`);
        }
      }

      // 7. Post review to GitHub (only with --post and non-zero findings)
      if (options.post && findings.length > 0) {
        try {
          const postStart = performance.now();
          printProgress('Posting review to GitHub...');

          const diffHunks = parseDiffHunks(prData.diff);
          const { inline, offDiff } = partitionFindings(findings, diffHunks);
          const reviewBody = buildReviewBody(offDiff);
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
          const postDuration = performance.now() - postStart;
          if (options.verbose) {
            printDebug(`Post: ${formatDuration(postDuration)}`);
          }
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

      // 4. Analyze diff with progress and timing
      const quickPrompt = buildPrompt(prData, options.mode);
      const analyzeStart = performance.now();
      try {
        printProgress('Analyzing diff...');
        const result = await analyzeDiff(prData, options.model, options.mode);
        printProgressDone();
        findings = result.findings;

        const analyzeDuration = performance.now() - analyzeStart;

        // Model line always visible
        printModel(result.model);

        if (options.verbose) {
          printDebug(`Analyze: ${formatDuration(analyzeDuration)}, prompt ${estimateTokens(quickPrompt.length)}`);
        }
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

      // Generate HTML report (if requested)
      if (options.html) {
        const reportFile = generateHtmlReport(prData, findings, parsed);
        openInBrowser(reportFile);
      }

      // 6. Finding counts debug
      if (options.verbose) {
        if (options.post) {
          const diffHunks = parseDiffHunks(prData.diff);
          const { inline, offDiff } = partitionFindings(findings, diffHunks);
          const posted = inline.length + (offDiff.length > 0 ? 1 : 0);
          printDebug(`Findings: ${findings.length} raw, ${posted} posted`);
        } else {
          printDebug(`Findings: ${findings.length} raw`);
        }
      }

      // 7. Post review to GitHub (only with --post and non-zero findings)
      if (options.post && findings.length > 0) {
        try {
          const postStart = performance.now();
          printProgress('Posting review to GitHub...');

          const diffHunks = parseDiffHunks(prData.diff);
          const { inline, offDiff } = partitionFindings(findings, diffHunks);
          const reviewBody = buildReviewBody(offDiff);
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
          const postDuration = performance.now() - postStart;
          if (options.verbose) {
            printDebug(`Post: ${formatDuration(postDuration)}`);
          }
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

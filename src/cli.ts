import { Command } from 'commander';
import pc from 'picocolors';
import { parsePRUrl } from './url-parser.js';
import { checkPrerequisites } from './prerequisites.js';
import { createOctokit, fetchPRData, postReview } from './github.js';
import { printPRSummary, printErrors, printVerbose, printProgress, printProgressDone, printAnalysisSummary, printFindings } from './output.js';
import { analyzeDiff } from './analyzer.js';
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
  .option('--quick', 'Quick review: analyze diff only (default until deep mode)')
  .option('--post', 'Post review to GitHub PR')
  .action(async (prUrl: string, options: { verbose?: boolean; quick?: boolean; post?: boolean }) => {
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

    // 4. Analyze diff with progress
    let findings;
    try {
      printProgress('Analyzing diff...');
      const result = await analyzeDiff(prData);
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
  });

program.parse();

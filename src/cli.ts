import { Command } from 'commander';
import pc from 'picocolors';
import { parsePRUrl } from './url-parser.js';
import { checkPrerequisites } from './prerequisites.js';
import { createOctokit, fetchPRData } from './github.js';
import { printPRSummary, printErrors, printVerbose } from './output.js';
import { EXIT_PREREQ, EXIT_INVALID_URL, EXIT_API_ERROR } from './errors.js';

const program = new Command();

program
  .name('codereview')
  .description('AI-powered GitHub PR code review')
  .version('0.1.0')
  .argument('<pr-url>', 'GitHub Pull Request URL')
  .option('-v, --verbose', 'Show debug info including raw diff')
  .action(async (prUrl: string, options: { verbose?: boolean }) => {
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

    // 3. Fetch PR data
    try {
      const octokit = createOctokit();
      const prData = await fetchPRData(octokit, parsed.owner, parsed.repo, parsed.prNumber);

      // 4. Print summary
      printPRSummary(prData);

      // 5. Verbose output
      if (options.verbose) {
        printVerbose(prData);
      }
    } catch (error: unknown) {
      // 6. API error handling
      console.error(pc.red('\u2716 Failed to fetch PR data'));
      if (error instanceof Error && error.message) {
        console.error(pc.dim('  ' + error.message));
      }
      process.exit(EXIT_API_ERROR);
    }
  });

program.parse();

import pc from 'picocolors';
import type { PRData, PrereqFailure } from './types.js';

/**
 * Print a colored compact PR summary with diff-stat file list.
 */
export function printPRSummary(pr: PRData): void {
  // Title
  console.log(pc.bold(pr.title));

  // Metadata line: #number author headBranch -> baseBranch
  console.log(
    `${pc.dim(`#${pr.number}`)} ${pc.cyan(pr.author)} ${pc.dim(`${pr.headBranch} -> ${pr.baseBranch}`)}`,
  );

  // Stats line: +additions -deletions N files changed
  console.log(
    `${pc.green(`+${pr.additions}`)} ${pc.red(`-${pr.deletions}`)} ${pc.dim(`${pr.changedFiles} files changed`)}`,
  );

  // Blank line before file list
  console.log();

  // Diff-stat style file list
  for (const file of pr.files) {
    console.log(
      `${pc.green(`+${file.additions}`)} ${pc.red(`-${file.deletions}`)} ${file.filename}`,
    );
  }

  // Blank line + completion message
  console.log();
  console.log(pc.green('PR data fetched successfully'));
}

/**
 * Print prerequisite failures as red errors with actionable help.
 */
export function printErrors(failures: PrereqFailure[]): void {
  for (const f of failures) {
    console.error(pc.red(`\u2716 ${f.message}`));
    console.error(pc.dim(`  ${f.help}`));
  }
}

/**
 * Print verbose output including color-coded raw diff content.
 */
export function printVerbose(pr: PRData): void {
  console.log(pc.bold('Raw Diff:'));
  for (const line of pr.diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      console.log(pc.green(line));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      console.log(pc.red(line));
    } else if (line.startsWith('@@')) {
      console.log(pc.cyan(line));
    } else if (line.startsWith('diff ') || line.startsWith('index ')) {
      console.log(pc.bold(line));
    } else {
      console.log(line);
    }
  }
  console.log(pc.dim(`(${pr.diff.length} characters)`));
}

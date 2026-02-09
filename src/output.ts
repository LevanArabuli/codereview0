import pc from 'picocolors';
import type { PRData, PrereqFailure } from './types.js';
import type { ReviewFinding } from './schemas.js';

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

/**
 * Print a progress message without a trailing newline.
 * Used for "Fetching PR data..." where " done" is appended on the same line.
 */
export function printProgress(message: string): void {
  process.stdout.write(message);
}

/**
 * Complete a progress line by printing " done" in green with a newline.
 */
export function printProgressDone(): void {
  console.log(pc.green(' done'));
}

/**
 * Print a summary of findings counts by severity.
 * Only includes severities with count > 0.
 */
export function printAnalysisSummary(findings: ReviewFinding[]): void {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }

  const total = findings.length;
  const parts: string[] = [];

  const severities = ['bug', 'security', 'suggestion', 'nitpick'] as const;
  for (const severity of severities) {
    const count = counts[severity];
    if (count && count > 0) {
      if (severity === 'bug') {
        parts.push(`${count} bug${count === 1 ? '' : 's'}`);
      } else if (severity === 'security') {
        parts.push(`${count} security`);
      } else if (severity === 'suggestion') {
        parts.push(`${count} suggestion${count === 1 ? '' : 's'}`);
      } else if (severity === 'nitpick') {
        parts.push(`${count} nitpick${count === 1 ? '' : 's'}`);
      }
    }
  }

  const summary = parts.length > 0 ? `: ${parts.join(', ')}` : '';
  console.log(`Found ${total} finding${total === 1 ? '' : 's'}${summary}`);
}

/** Severity sort order: lower index = higher priority */
const SEVERITY_ORDER: Record<string, number> = {
  bug: 0,
  security: 1,
  suggestion: 2,
  nitpick: 3,
};

/** Color-coded severity icons for terminal display */
const SEVERITY_ICONS: Record<string, string> = {
  bug: pc.red('\u2716 bug'),
  security: pc.yellow('\u26A0 security'),
  suggestion: pc.blue('\u25C6 suggestion'),
  nitpick: pc.dim('\u25CB nitpick'),
};

/**
 * Print a summary line showing how many files were analyzed during deep exploration.
 */
export function printExplorationSummary(filesAnalyzed: number): void {
  console.log(pc.dim(`  ${filesAnalyzed} files analyzed`));
}

/**
 * Print findings grouped by file with color-coded severity icons.
 * Findings within each file are sorted by severity (bug > security > suggestion > nitpick).
 * Nitpick findings are rendered entirely in dim text.
 * Empty findings array produces no output.
 */
export function printFindings(findings: ReviewFinding[]): void {
  if (findings.length === 0) return;

  // Group findings by file
  const byFile = new Map<string, ReviewFinding[]>();
  for (const f of findings) {
    const group = byFile.get(f.file);
    if (group) {
      group.push(f);
    } else {
      byFile.set(f.file, [f]);
    }
  }

  // Print each file group
  for (const [file, fileFindings] of byFile) {
    // Sort by severity within file
    fileFindings.sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
    );

    // File header with finding count
    const count = fileFindings.length;
    console.log(`\n${pc.bold(file)} (${count} finding${count === 1 ? '' : 's'})`);

    // Each finding
    for (const f of fileFindings) {
      const icon = SEVERITY_ICONS[f.severity] ?? f.severity;
      const lineRef = pc.dim('L' + f.line);
      const confidence = pc.dim('[' + f.confidence + ']');

      if (f.severity === 'nitpick') {
        // Entire nitpick line rendered in dim
        console.log(pc.dim(`  \u25CB nitpick L${f.line} [${f.confidence}] ${f.description}`));
      } else {
        console.log(`  ${icon} ${lineRef} ${confidence} ${f.description}`);
      }
    }
  }
}

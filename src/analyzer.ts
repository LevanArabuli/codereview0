import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { ReviewResultSchema, reviewJsonSchema } from './schemas.js';
import { buildPrompt } from './prompt.js';
import type { PRData } from './types.js';
import type { ReviewResult } from './schemas.js';

const execFile = promisify(execFileCb);

/** Analysis timeout: 5 minutes */
const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;

/** Max buffer for Claude CLI output: 10MB */
const MAX_BUFFER = 10 * 1024 * 1024;

/** Max number of analysis attempts (1 initial + 1 retry) */
const MAX_ATTEMPTS = 2;

/** Shape of the JSON wrapper returned by Claude CLI --output-format json */
interface ClaudeResponse {
  type: string;
  subtype: string;
  cost_usd: number;
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  session_id: string;
}

/**
 * Analyze a PR diff using Claude CLI and return structured review findings.
 *
 * Invokes `claude -p` as a subprocess with JSON output format and
 * Zod-derived JSON Schema constraint. Implements double JSON parsing
 * (wrapper + result), Zod validation, retry-once logic, and 5-minute timeout.
 */
export async function analyzeDiff(prData: PRData): Promise<ReviewResult> {
  const prompt = buildPrompt(prData);

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const { stdout } = await execFile('claude', [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--json-schema',
        reviewJsonSchema,
        '--max-turns',
        '1',
        '--tools',
        '',
      ], {
        timeout: ANALYSIS_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf-8',
      });

      // Double JSON parse: first the Claude CLI wrapper, then the result
      const wrapper: ClaudeResponse = JSON.parse(stdout);

      if (wrapper.is_error || wrapper.subtype !== 'success') {
        throw new Error(`Claude CLI error: ${wrapper.result}`);
      }

      // Parse the result field -- may be a JSON string or already an object
      let data: unknown;
      if (typeof wrapper.result === 'string') {
        try {
          data = JSON.parse(wrapper.result);
        } catch {
          // If JSON.parse fails, result might already be parsed (shouldn't happen, but handle gracefully)
          data = wrapper.result;
        }
      } else {
        data = wrapper.result;
      }

      // Validate against Zod schema
      const parsed = ReviewResultSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(`Response validation failed: ${parsed.error.message}`);
      }

      return parsed.data;
    } catch (error: unknown) {
      // Check for timeout (execFile sets killed=true when process is killed due to timeout)
      if (error instanceof Error && 'killed' in error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
        throw new Error(
          'Analysis timed out after 5 minutes. The PR diff may be too large for quick review.',
        );
      }

      lastError = error instanceof Error ? error : new Error(String(error));

      // If this was the first attempt, retry
      if (attempt < MAX_ATTEMPTS - 1) {
        continue;
      }
    }
  }

  // Both attempts failed -- throw the last error
  throw lastError ?? new Error('Analysis failed');
}

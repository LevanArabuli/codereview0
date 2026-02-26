import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { ReviewResultSchema } from "./schemas.js";
import { buildPrompt, buildAgenticPrompt, type ReviewMode } from "./prompt.js";
import type { PRData } from "./types.js";
import type { ReviewFinding } from "./schemas.js";
import { scrubSecrets } from "./errors.js";

const execFile = promisify(execFileCb);

/** Analysis timeout: 5 minutes */
const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;

/** Max buffer for Claude CLI output: 10MB */
const MAX_BUFFER = 10 * 1024 * 1024;

/** Max number of analysis attempts (1 initial + 1 retry) */
const MAX_ATTEMPTS = 2;

const MAX_ANALYSIS_TURNS = 10;

/** Agentic review timeout: 10 minutes */
const AGENTIC_TIMEOUT_MS = 10 * 60 * 1000;

/** Max agentic turns -- safety net to prevent infinite loops (user decision: 50-100 range, midpoint) */
const MAX_AGENTIC_TURNS = 75;

/** Env var prefixes to strip from Claude CLI subprocess (blocklist approach, SUB-02) */
const DANGEROUS_PREFIXES = [
  'AWS_', 'AZURE_', 'GCP_', 'GOOGLE_',
  'DATABASE_', 'REDIS_', 'MONGO_',
  'SECRET_', 'PASSWORD_',
  'CI_', 'JENKINS_', 'TRAVIS_', 'CIRCLE_',
  'TOKEN_', 'KEY_',
];

/** Exact env var names to always strip */
const DANGEROUS_EXACT = new Set(['DATABASE_URL', 'REDIS_URL']);

/** Env vars to keep even if they match a dangerous prefix */
const KEEP_LIST = new Set(['ANTHROPIC_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN']);

/**
 * Build a filtered copy of process.env for the Claude CLI subprocess.
 * Strips known-dangerous env vars (cloud credentials, DB URLs, CI secrets)
 * while keeping vars required for Claude CLI and GitHub operations.
 */
function filterEnv(): NodeJS.ProcessEnv {
  const filtered: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (KEEP_LIST.has(key)) {
      filtered[key] = value;
      continue;
    }
    if (DANGEROUS_EXACT.has(key)) continue;
    if (DANGEROUS_PREFIXES.some(prefix => key.startsWith(prefix))) continue;
    filtered[key] = value;
  }
  return filtered;
}

/** Shape of the JSON wrapper returned by Claude CLI --output-format json */
interface ClaudeResponse {
  type: string;
  subtype: string;
  cost_usd?: number;           // Legacy field (CLI v1.x)
  total_cost_usd?: number;     // Current field (CLI v2.x)
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  session_id: string;
  modelUsage?: Record<string, unknown>;
}

/** Operational metadata from Claude CLI agentic session */
export interface AnalysisMeta {
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  duration_api_ms: number;
  session_id: string;
}

/** Structured analysis result with findings and model identification */
interface AnalysisResult {
  findings: ReviewFinding[];
  model: string;
  meta?: AnalysisMeta;
}

/**
 * Extract the model ID from the Claude CLI response wrapper.
 * Uses the modelUsage field keys (first key is the model ID),
 * with fallback to the CLI-provided model name or 'unknown'.
 */
function extractModelId(wrapper: ClaudeResponse, fallbackModel?: string): string {
  if (wrapper.modelUsage) {
    const models = Object.keys(wrapper.modelUsage);
    if (models.length > 0) return models[0];
  }
  return fallbackModel ?? 'unknown';
}

/**
 * Analyze a PR diff using Claude CLI and return structured review findings.
 *
 * Invokes `claude -p` as a subprocess with JSON output format and
 * Zod-derived JSON Schema constraint. Implements double JSON parsing
 * (wrapper + result), Zod validation, retry-once logic, and 5-minute timeout.
 */
export async function analyzeDiff(prData: PRData, model?: string, mode?: ReviewMode): Promise<AnalysisResult> {
  const prompt = buildPrompt(prData, mode);

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const args = [
        "-p",
        prompt,
        "--output-format",
        "json",
        "--max-turns",
        String(MAX_ANALYSIS_TURNS),
      ];
      if (model) {
        args.push("--model", model);
      }
      const p = execFile(
        "claude",
        args,
        {
          timeout: ANALYSIS_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          encoding: "utf-8",
        },
      );
      p.child.stdin?.end();
      const { stdout } = await p;

      // Double JSON parse: first the Claude CLI wrapper, then the result
      const wrapper: ClaudeResponse = JSON.parse(stdout);

      if (wrapper.is_error || wrapper.subtype !== "success") {
        throw new Error(
          `Claude CLI error: ${wrapper.result ?? "unknown error"}`,
        );
      }

      // Parse result: try direct JSON parse, then extract JSON from text
      let data: unknown;
      try {
        data = JSON.parse(wrapper.result);
      } catch {
        // Result may contain text around JSON — extract the JSON object
        const match = wrapper.result.match(/\{[\s\S]*"findings"[\s\S]*\}/);
        if (match) {
          data = JSON.parse(match[0]);
        } else {
          throw new Error("Could not find JSON in Claude response");
        }
      }

      // Validate against Zod schema
      const parsed = ReviewResultSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(`Response validation failed: ${parsed.error.message}`);
      }

      return {
        findings: parsed.data.findings,
        model: extractModelId(wrapper, model),
        meta: {
          cost_usd: wrapper.total_cost_usd ?? wrapper.cost_usd ?? 0,
          duration_ms: wrapper.duration_ms ?? 0,
          num_turns: wrapper.num_turns ?? 0,
          duration_api_ms: wrapper.duration_api_ms ?? 0,
          session_id: wrapper.session_id ?? '',
        },
      };
    } catch (error: unknown) {
      // Check for timeout (execFile sets killed=true when process is killed due to timeout)
      if (
        error instanceof Error &&
        "killed" in error &&
        (error as NodeJS.ErrnoException & { killed?: boolean }).killed
      ) {
        throw new Error(
          "Analysis timed out after 5 minutes. The PR diff may be too large for quick review.",
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
  throw lastError ?? new Error("Analysis failed");
}

/**
 * Parse stream-json output to find the final 'result' event.
 *
 * With `--output-format stream-json`, stdout contains newline-delimited JSON
 * events. The last event with `type === 'result'` contains the complete response
 * in the same shape as the `--output-format json` wrapper (ClaudeResponse).
 */
function parseStreamResult(stdout: string): ClaudeResponse {
  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]);
      if (event.type === 'result') {
        return event as ClaudeResponse;
      }
    } catch {
      // Skip malformed lines
    }
  }
  throw new Error('Deep review failed: no result event found in stream output');
}

/**
 * Perform a unified agentic code review via a single Claude CLI session.
 *
 * Invokes `claude -p` with `--output-format stream-json` and `--verbose` via
 * `spawn`, streaming Claude's exploration output (stderr) to the terminal in
 * real-time while accumulating stdout for JSON parsing. Returns the same
 * `AnalysisResult { findings, model }` shape as `analyzeDiff()`.
 *
 * On any failure (timeout, parse error, max-turns exceeded), throws an Error
 * with 'Deep review failed: [reason]' -- no fallback to quick mode.
 */
export async function analyzeAgentic(
  prData: PRData,
  clonePath: string,
  model?: string,
  mode?: ReviewMode,
  verbose?: boolean,
): Promise<AnalysisResult> {
  const prompt = buildAgenticPrompt(prData, mode);

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(MAX_AGENTIC_TURNS),
  ];
  if (model) {
    args.push('--model', model);
  }

  return new Promise<AnalysisResult>((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: clonePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: filterEnv(),
    });

    child.stdin?.end();

    // Accumulate stdout for JSON parsing
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    // Accumulate stderr AND stream to terminal for live exploration visibility
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(scrubSecrets(text));
    });

    // Manual timeout -- spawn does NOT support the timeout option
    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
    }, AGENTIC_TIMEOUT_MS);

    let settled = false;

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      if (!settled) {
        settled = true;
        reject(new Error(`Deep review failed: ${err.message}`));
      }
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeoutId);
      if (settled) return;
      settled = true;

      // Timeout: killed by our setTimeout handler
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new Error('Deep review failed: timed out after 10 minutes'));
        return;
      }

      // Non-zero exit
      if (code !== 0) {
        if (verbose) {
          console.error('\n[debug] Raw stdout:', scrubSecrets(stdout.slice(0, 2000)));
          console.error('[debug] Raw stderr:', scrubSecrets(stderr.slice(0, 2000)));
        }
        const reason = stderr.includes('max turns')
          ? `max turns (${MAX_AGENTIC_TURNS}) reached without completing the review`
          : `claude exited with code ${code}`;
        reject(new Error(`Deep review failed: ${reason}`));
        return;
      }

      // Successful exit: parse stream-json output
      try {
        const wrapper = parseStreamResult(stdout);

        if (wrapper.is_error || wrapper.subtype !== 'success') {
          throw new Error(wrapper.result ?? 'unknown error');
        }

        // Double parse: result field contains the findings JSON string
        let data: unknown;
        try {
          data = JSON.parse(wrapper.result);
        } catch {
          const match = wrapper.result.match(/\{[\s\S]*"findings"[\s\S]*\}/);
          if (match) {
            data = JSON.parse(match[0]);
          } else {
            throw new Error('could not find JSON in response');
          }
        }

        // Validate against Zod schema
        const parsed = ReviewResultSchema.safeParse(data);
        if (!parsed.success) {
          throw new Error(`response validation failed: ${parsed.error.message}`);
        }

        resolve({
          findings: parsed.data.findings,
          model: extractModelId(wrapper, model),
          meta: {
            cost_usd: wrapper.total_cost_usd ?? wrapper.cost_usd ?? 0,
            duration_ms: wrapper.duration_ms ?? 0,
            num_turns: wrapper.num_turns ?? 0,
            duration_api_ms: wrapper.duration_api_ms ?? 0,
            session_id: wrapper.session_id ?? '',
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (verbose) {
          console.error('\n[debug] Raw stdout:', scrubSecrets(stdout.slice(0, 2000)));
          console.error('[debug] Raw stderr:', scrubSecrets(stderr.slice(0, 2000)));
        }
        reject(new Error(`Deep review failed: ${message}`));
      }
    });
  });
}

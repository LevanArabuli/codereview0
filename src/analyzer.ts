import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { ReviewResultSchema } from "./schemas.js";
import { buildPrompt, buildDeepPrompt } from "./prompt.js";
import type { PRData } from "./types.js";
import type { ReviewResult } from "./schemas.js";

const execFile = promisify(execFileCb);

/** Analysis timeout: 5 minutes */
const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;

/** Max buffer for Claude CLI output: 10MB */
const MAX_BUFFER = 10 * 1024 * 1024;

/** Max number of analysis attempts (1 initial + 1 retry) */
const MAX_ATTEMPTS = 2;

/** Deep exploration timeout: 4 minutes */
const EXPLORATION_TIMEOUT_MS = 4 * 60 * 1000;

/** Max agentic exploration turns for deep mode */
const MAX_EXPLORATION_TURNS = 25;

const MAX_ANALYSIS_TURNS = 10;
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
export async function analyzeDiff(prData: PRData, model?: string): Promise<ReviewResult> {
  const prompt = buildPrompt(prData);

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

      return parsed.data;
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
 * Perform deep agentic exploration of a cloned repo to find cross-file impacts.
 *
 * Invokes `claude -p` as a multi-turn agentic subprocess with Read, Grep, Glob
 * tools and cwd set to the cloned repo. Uses prompt-based JSON instruction
 * (no --json-schema flag) and the same double-parse pattern as analyzeDiff.
 *
 * On timeout or error, returns empty findings (graceful degradation) so that
 * quick-mode findings still carry the review.
 */
export async function analyzeDeep(
  prData: PRData,
  clonePath: string,
  model?: string,
): Promise<ReviewResult> {
  const prompt = buildDeepPrompt(prData);

  try {
    const args = [
      "-p",
      prompt,
      "--max-turns",
      String(MAX_EXPLORATION_TURNS),
      "--tools",
      "Read,Grep,Glob",
      "--output-format",
      "json",
    ];
    if (model) {
      args.push("--model", model);
    }
    const p = execFile(
      "claude",
      args,
      {
        cwd: clonePath,
        timeout: EXPLORATION_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        encoding: "utf-8",
      },
    );
    p.child.stdin?.end();
    const { stdout } = await p;

    // Double JSON parse: first the Claude CLI wrapper, then the result
    const wrapper: ClaudeResponse = JSON.parse(stdout);

    if (wrapper.is_error || wrapper.subtype !== "success") {
      throw new Error(`Claude CLI error: ${wrapper.result ?? "unknown error"}`);
    }

    // Parse result: try direct JSON parse, then extract JSON from text
    let data: unknown;
    try {
      data = JSON.parse(wrapper.result);
    } catch {
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

    return parsed.data;
  } catch (error: unknown) {
    // Check for timeout (execFile sets killed=true when process is killed due to timeout)
    if (
      error instanceof Error &&
      "killed" in error &&
      (error as NodeJS.ErrnoException & { killed?: boolean }).killed
    ) {
      console.error(
        "Deep exploration timed out -- proceeding with quick analysis only",
      );
      return { findings: [] };
    }

    // All other errors: degrade gracefully to empty findings
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Deep exploration failed: ${message} -- proceeding with quick analysis only`,
    );
    return { findings: [] };
  }
}

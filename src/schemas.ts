import { z } from 'zod';

/** Schema for a related code location referenced by a finding */
export const RelatedLocationSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  reason: z.string(),
});

/** Schema for a single review finding */
export const ReviewFindingSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  endLine: z.number().int().optional(),
  severity: z.enum(['bug', 'security', 'suggestion', 'nitpick']),
  confidence: z.enum(['high', 'medium', 'low']),
  category: z.string(),
  description: z.string(),
  suggestedFix: z.string().optional(),
  relatedLocations: z.array(RelatedLocationSchema).optional(),
});

/** Schema for the complete review result (flat array of findings) */
export const ReviewResultSchema = z.object({
  findings: z.array(ReviewFindingSchema),
});

/** A related code location referenced by a finding */
export type RelatedLocation = z.infer<typeof RelatedLocationSchema>;

/** A single review finding with severity, confidence, and location */
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

/** Complete review result containing all findings */
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/** JSON Schema string for ReviewResult, used with Claude CLI --json-schema flag */
export const reviewJsonSchema = JSON.stringify(z.toJSONSchema(ReviewResultSchema));

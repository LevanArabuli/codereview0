import { z } from 'zod';

/** Schema for a related code location referenced by a finding */
const RelatedLocationSchema = z.object({
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

/** A single review finding with severity, confidence, and location */
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;


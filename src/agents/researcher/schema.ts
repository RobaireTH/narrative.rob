import { z } from 'zod';

export const researcher_update_modes = [
  'ORDINARY',
  'DECISIVE_RESOLUTION',
  'THESIS_FAILURE',
] as const;

export type ResearcherUpdateMode =
  (typeof researcher_update_modes)[number];

export const researcher_resolution_hint_values = [
  'NONE',
  'DECISIVE_TRUE',
  'DECISIVE_FALSE',
] as const;

export type ResearcherResolutionHint =
  (typeof researcher_resolution_hint_values)[number];

/**
 * Structured evidence judgment emitted by the Researcher LLM.
 *
 * This is the core output of the semantic layer. The backend deterministic
 * updater consumes this and decides how to move probability, conviction,
 * resolution state, and top-level narrative status.
 */
export const researcher_evidence_item_schema = z.object({
  directness_weight: z
    .number()
    .min(0)
    .max(1)
    .describe('Answers: "How directly does this evidence bear on the event under this thesis?". 1.0 = highly direct, 0.70 = strong proxy, 0.30 = weak proxy, 0.00 = noise/irrelevant. Override with thesis mandate.'),
  duplicate_risk: z
    .number()
    .min(0)
    .max(1)
    .describe('Set high when the evidence appears to be a rewrite, syndication, or repeated factual payload rather than genuinely new independent information.'),
  matches_failure_condition: z
    .boolean()
    .default(false)
    .describe('Whether this evidence matches a top-level thesis failure condition.'),
  summary: z
    .string()
    .min(1)
    .optional()
    .describe('A concise 1-sentence explanation of how this evidence and its source align with or violate the Narrators strict thesis mandate. You must write this summary to justify the source_weight and directness_weight you are about to assign.'),
  refute_strength: z
    .number()
    .min(0)
    .max(1)
    .describe('How strongly this evidence refutes the target event.'),
  source_ref: z
    .string()
    .min(1)
    .describe('Source reference for provenance, usually a URL or a compact identifier.'),
  resolution_hint: z
    .enum(researcher_resolution_hint_values)
    .default('NONE')
    .describe('Use NONE unless the evidence is resolution-grade. DECISIVE_TRUE/DECISIVE_FALSE signals to permanently lock the event.'),
  source_weight: z
    .number()
    .min(0)
    .max(1)
    .describe('Answers: "How much should this source count under this thesis?". 1.0 = highly trusted, 0.75 = acceptable, 0.30 = weak, 0.00 = ignored. Override with thesis mandate. Do not use this to encode personal market views.'),
  support_strength: z
    .number()
    .min(0)
    .max(1)
    .describe('How strongly this evidence supports the target event.'),
  target_id: z
    .string()
    .min(1)
    .describe('Identifier of the narrative or event this evidence is about.'),
  target_type: z
    .enum(['NARRATIVE', 'EVENT'])
    .describe('Whether this evidence targets the whole narrative or one event.'),
  ambiguity_index: z
    .number()
    .min(0)
    .max(1)
    .describe('Set high when the evidence is vague, incomplete, partial, or speculative.'),
  update_mode: z
    .enum(researcher_update_modes)
    .describe('ORDINARY for standard evidence. THESIS_FAILURE only when matching a top-level failure condition. DECISIVE_RESOLUTION only when the evidence is resolution-grade.'),
});

export type ResearcherEvidenceItem = z.infer<
  typeof researcher_evidence_item_schema
>;

/**
 * LLM-facing payload for the final Researcher commit step.
 *
 * The model provides evidence judgments only; the backend injects timestamps and
 * performs the actual belief-state update.
 */
export const commit_research_update_schema = z.object({
  evidence_items: z
    .array(researcher_evidence_item_schema)
    .describe('Structured evidence judgments to be applied in one deterministic update batch.'),
});

export type CommitResearchUpdateInput = z.infer<
  typeof commit_research_update_schema
>;

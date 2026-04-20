import { z } from 'zod';

export const narrative_statuses = [
  "ACTIVE",
  "PAUSED",
  "EXPIRED",
  "FAILED",
  "COMPLETED",
  "ARCHIVED",
] as const;

export type NarrativeStatus = (typeof narrative_statuses)[number];

export const narrative_event_statuses = [
  "PENDING",
  "LOCKED",
  "RESOLVED_TRUE",
  "RESOLVED_FALSE",
  "EXPIRED",
  "CANCELLED",
] as const;

export type NarrativeEventStatus = (typeof narrative_event_statuses)[number];

export const narrative_dependency_types = [
  "UNLOCK_IF_TRUE",
  "UNLOCK_IF_FALSE",
  "MODIFIER_POSITIVE",
  "MODIFIER_NEGATIVE",
] as const;

export type NarrativeDependencyType =
  (typeof narrative_dependency_types)[number];

export type ISO8601String = string;

export const narrative_event_dependency_schema = z.object({
  parent_event: z.string().min(1),
  type: z.enum(narrative_dependency_types),
  weight: z.number().positive().optional(),
});

export interface NarrativeEventDependency {
  parent_event: string;
  type: NarrativeDependencyType;
  weight?: number; // Used only for MODIFIER_POSITIVE or MODIFIER_NEGATIVE
}

export const narrative_event_schema = z.object({
  event_id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(narrative_event_statuses),
  narrative_weight: z.number().int().min(1),
  belief: z.number().min(0).max(1),
  disbelief: z.number().min(0).max(1),
  uncertainty: z.number().min(0).max(1),
  base_rate: z.number().min(0).max(1),
  probability: z.number().min(0).max(1),
  conviction: z.number().min(0).max(1),
  depends_on: z.array(narrative_event_dependency_schema),
});

export interface NarrativeEvent {
  event_id: string;
  label: string;
  status: NarrativeEventStatus;
  narrative_weight: number; // Integer defining relative importance for dynamic allocation
  belief: number; // Subjective-logic belief mass
  disbelief: number; // Subjective-logic disbelief mass
  uncertainty: number; // Subjective-logic uncertainty mass
  base_rate: number; // Prior tendency used when uncertainty is high
  probability: number; // Derived directional expectation
  conviction: number; // Derived robustness, usually 1 - uncertainty
  depends_on: NarrativeEventDependency[];
}

export const narrative_json_schema = z.object({
  narrative_id: z.string().min(1),
  narrator_id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(narrative_statuses),
  thesis_text: z.string().min(1),
  failure_conditions: z.array(z.string().min(1)),
  timestamps: z.object({
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    expires_at: z.string().datetime().optional(),
  }),
  events: z.array(narrative_event_schema),
});

export interface NarrativeJson {
  narrative_id: string;
  narrator_id: string;
  title: string;
  status: NarrativeStatus;
  thesis_text: string; // Subjective worldview injected into the Researcher prompt
  failure_conditions: string[];
  timestamps: {
    created_at: ISO8601String;
    updated_at: ISO8601String; // Required to track when the Researcher last updated event metrics
    expires_at?: ISO8601String;
  };
  events: NarrativeEvent[];
}

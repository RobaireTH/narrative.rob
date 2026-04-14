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

export interface NarrativeEventDependency {
  parent_event: string;
  type: NarrativeDependencyType;
  weight?: number; // Used only for MODIFIER_POSITIVE or MODIFIER_NEGATIVE
}

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

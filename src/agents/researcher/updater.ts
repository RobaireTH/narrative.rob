import { randomUUID } from 'crypto';

import {
  create_empty_logs,
  type AuditLogEntry,
  type LogsJson,
} from '../../domain/logs/schema';
import type {
  NarrativeJson,
  NarrativeEvent,
  NarrativeEventStatus,
} from '../../domain/narrative/schema';
import type {
  CommitResearchUpdateInput,
  ResearcherEvidenceItem,
  ResearcherResolutionHint,
} from './schema';

const EPSILON = 1e-6;
const EVENT_RESOLVE_TRUE_PROBABILITY = 0.95;
const EVENT_RESOLVE_FALSE_PROBABILITY = 0.05;
const EVENT_RESOLVE_CONVICTION = 0.85;
const FAILURE_SOURCE_WEIGHT_THRESHOLD = 0.75;
const FAILURE_SUPPORT_THRESHOLD = 0.7;
const DUPLICATE_RISK_THRESHOLD = 0.5;

type SubjectiveOpinion = {
  base_rate: number;
  belief: number;
  disbelief: number;
  uncertainty: number;
};

export interface ResearcherEventUpdateSummary {
  evidence_count: number;
  event_id: string;
  new_conviction: number;
  new_probability: number;
  new_status: NarrativeEventStatus;
  old_conviction: number;
  old_probability: number;
  old_status: NarrativeEventStatus;
  summary_items: string[];
}

export interface ResearcherCommitResult {
  event_updates: ResearcherEventUpdateSummary[];
  log_entry: AuditLogEntry;
  logs: LogsJson;
  narrative: NarrativeJson;
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function normalizeOpinion(opinion: SubjectiveOpinion): SubjectiveOpinion {
  const belief = clamp(opinion.belief);
  const disbelief = clamp(opinion.disbelief);
  const uncertainty = clamp(opinion.uncertainty);
  const total = belief + disbelief + uncertainty;

  if (total <= EPSILON) {
    return {
      base_rate: clamp(opinion.base_rate),
      belief: 0,
      disbelief: 0,
      uncertainty: 1,
    };
  }

  return {
    base_rate: clamp(opinion.base_rate),
    belief: belief / total,
    disbelief: disbelief / total,
    uncertainty: uncertainty / total,
  };
}

function deriveProbability(opinion: SubjectiveOpinion) {
  return clamp(opinion.belief + opinion.base_rate * opinion.uncertainty);
}

function deriveConviction(opinion: SubjectiveOpinion) {
  return clamp(1 - opinion.uncertainty);
}

function getCurrentOpinion(event: NarrativeEvent): SubjectiveOpinion {
  return normalizeOpinion({
    base_rate: event.base_rate,
    belief: event.belief,
    disbelief: event.disbelief,
    uncertainty: event.uncertainty,
  });
}

function deriveEvidenceOpinion(item: ResearcherEvidenceItem, base_rate: number): SubjectiveOpinion {
  const raw_belief = clamp(item.support_strength) * (1 - clamp(item.ambiguity_index));
  const raw_disbelief = clamp(item.refute_strength) * (1 - clamp(item.ambiguity_index));
  const raw_uncertainty = clamp(item.ambiguity_index);

  const normalized_raw = normalizeOpinion({
    base_rate,
    belief: raw_belief,
    disbelief: raw_disbelief,
    uncertainty: raw_uncertainty,
  });

  const discount = clamp(item.source_weight) * clamp(item.directness_weight);
  return normalizeOpinion({
    base_rate,
    belief: discount * normalized_raw.belief,
    disbelief: discount * normalized_raw.disbelief,
    uncertainty: 1 - discount * normalized_raw.belief - discount * normalized_raw.disbelief,
  });
}

function cumulativeBeliefFusion(left: SubjectiveOpinion, right: SubjectiveOpinion): SubjectiveOpinion {
  const denominator =
    left.uncertainty + right.uncertainty - left.uncertainty * right.uncertainty;

  if (denominator <= EPSILON) {
    return normalizeOpinion({
      base_rate: left.base_rate,
      belief: left.belief,
      disbelief: left.disbelief,
      uncertainty: left.uncertainty,
    });
  }

  return normalizeOpinion({
    base_rate: left.base_rate,
    belief:
      (left.belief * right.uncertainty + right.belief * left.uncertainty) /
      denominator,
    disbelief:
      (left.disbelief * right.uncertainty + right.disbelief * left.uncertainty) /
      denominator,
    uncertainty:
      (left.uncertainty * right.uncertainty) / denominator,
  });
}

function averagingBeliefFusion(left: SubjectiveOpinion, right: SubjectiveOpinion): SubjectiveOpinion {
  const denominator = left.uncertainty + right.uncertainty;

  if (denominator <= EPSILON) {
    return normalizeOpinion({
      base_rate: left.base_rate,
      belief: (left.belief + right.belief) / 2,
      disbelief: (left.disbelief + right.disbelief) / 2,
      uncertainty: (left.uncertainty + right.uncertainty) / 2,
    });
  }

  return normalizeOpinion({
    base_rate: left.base_rate,
    belief:
      (left.belief * right.uncertainty + right.belief * left.uncertainty) /
      denominator,
    disbelief:
      (left.disbelief * right.uncertainty + right.disbelief * left.uncertainty) /
      denominator,
    uncertainty:
      (2 * left.uncertainty * right.uncertainty) / denominator,
  });
}

function shouldFailNarrative(item: ResearcherEvidenceItem) {
  if (
    item.target_type !== 'NARRATIVE' ||
    !item.matches_failure_condition ||
    item.update_mode !== 'THESIS_FAILURE'
  ) {
    return false;
  }

  const evidence = deriveEvidenceOpinion(item, 0.5);
  return (
    clamp(item.source_weight) >= FAILURE_SOURCE_WEIGHT_THRESHOLD &&
    evidence.belief >= FAILURE_SUPPORT_THRESHOLD
  );
}

function maybeResolveByHint(params: {
  conviction: number;
  hint: ResearcherResolutionHint;
  probability: number;
}) {
  if (
    params.hint === 'DECISIVE_TRUE' &&
    params.probability >= EVENT_RESOLVE_TRUE_PROBABILITY &&
    params.conviction >= EVENT_RESOLVE_CONVICTION
  ) {
    return 'RESOLVED_TRUE' as const;
  }

  if (
    params.hint === 'DECISIVE_FALSE' &&
    params.probability <= EVENT_RESOLVE_FALSE_PROBABILITY &&
    params.conviction >= EVENT_RESOLVE_CONVICTION
  ) {
    return 'RESOLVED_FALSE' as const;
  }

  return null;
}

function maybeResolveByThresholds(params: {
  conviction: number;
  probability: number;
}) {
  if (
    params.probability >= EVENT_RESOLVE_TRUE_PROBABILITY &&
    params.conviction >= EVENT_RESOLVE_CONVICTION
  ) {
    return 'RESOLVED_TRUE' as const;
  }

  if (
    params.probability <= EVENT_RESOLVE_FALSE_PROBABILITY &&
    params.conviction >= EVENT_RESOLVE_CONVICTION
  ) {
    return 'RESOLVED_FALSE' as const;
  }

  return null;
}

function resolveEventState(event: NarrativeEvent, status: 'RESOLVED_TRUE' | 'RESOLVED_FALSE') {
  event.status = status;
  event.belief = status === 'RESOLVED_TRUE' ? 1 : 0;
  event.disbelief = status === 'RESOLVED_FALSE' ? 1 : 0;
  event.uncertainty = 0;
  event.probability = status === 'RESOLVED_TRUE' ? 1 : 0;
  event.conviction = 1;
}

function applyEpistemicWipe(narrative: NarrativeJson): ResearcherEventUpdateSummary[] {
  const event_updates: ResearcherEventUpdateSummary[] = [];

  for (const event of narrative.events) {
    if (event.status === 'PENDING') {
      const old_probability = event.probability;
      const old_conviction = event.conviction;
      const old_status = event.status;

      event.belief = 0;
      event.disbelief = 0;
      event.uncertainty = 1;
      event.probability = event.base_rate;
      event.conviction = 0;

      event_updates.push({
        evidence_count: 0,
        event_id: event.event_id,
        new_conviction: event.conviction,
        new_probability: event.probability,
        new_status: event.status,
        old_conviction,
        old_probability,
        old_status,
        summary_items: ['AGM Contraction: Thesis invalidated, epistemic wipe applied.'],
      });
    }
  }

  return event_updates;
}

function buildAuditLog(params: {
  event_updates: ResearcherEventUpdateSummary[];
  narrative: NarrativeJson;
  now: string;
  top_level_message: string;
}) {
  return {
    actor: 'contextual_researcher' as const,
    event: 'CONTEXTUAL_RESEARCH_UPDATE',
    level: 'INFO' as const,
    log_id: randomUUID(),
    message: params.top_level_message,
    metadata: {
      event_updates: params.event_updates.map((update) => ({
        event_id: update.event_id,
        evidence_count: update.evidence_count,
        new_conviction: update.new_conviction,
        new_probability: update.new_probability,
        new_status: update.new_status,
        old_conviction: update.old_conviction,
        old_probability: update.old_probability,
        old_status: update.old_status,
        summary_items: update.summary_items,
      })),
      narrative_id: params.narrative.narrative_id,
      narrative_status: params.narrative.status,
    },
    timestamp: params.now,
  };
}

function topologicalSort(events: NarrativeEvent[]): NarrativeEvent[] {
  const sorted: NarrativeEvent[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const event_map = new Map(events.map((e) => [e.event_id, e]));

  function visit(event_id: string) {
    if (visited.has(event_id)) return;
    if (visiting.has(event_id)) {
      throw new Error(`Cycle detected involving event ${event_id}`);
    }
    visiting.add(event_id);
    const event = event_map.get(event_id);
    if (event) {
      for (const dep of event.depends_on) {
        visit(dep.parent_event);
      }
      sorted.push(event);
    }
    visiting.delete(event_id);
    visited.add(event_id);
  }

  for (const event of events) {
    if (!visited.has(event.event_id)) {
      visit(event.event_id);
    }
  }
  return sorted;
}

function synthesizePropagationEvidence(
  delta_p: number,
  uncertainty: number,
  dependency_type: string,
  dependency_weight: number,
  target_id: string,
  parent_id: string
): ResearcherEvidenceItem | null {
  if (Math.abs(delta_p) <= EPSILON) return null;

  const is_positive_edge = dependency_type === 'MODIFIER_POSITIVE' || dependency_type === 'UNLOCK_IF_TRUE';
  const is_negative_edge = dependency_type === 'MODIFIER_NEGATIVE' || dependency_type === 'UNLOCK_IF_FALSE';

  if (!is_positive_edge && !is_negative_edge) return null;

  const supports = is_positive_edge ? delta_p > 0 : delta_p < 0;
  const magnitude = Math.abs(delta_p);

  return {
    target_type: 'EVENT',
    target_id,
    update_mode: 'ORDINARY',
    source_ref: `SYSTEM_PROPAGATION_${parent_id}`,
    source_weight: 1.0,
    directness_weight: dependency_weight,
    support_strength: supports ? magnitude : 0,
    refute_strength: !supports ? magnitude : 0,
    ambiguity_index: uncertainty,
    duplicate_risk: 0,
    matches_failure_condition: false,
    resolution_hint: 'NONE',
  };
}

export function applyResearchEvidence(params: {
  input: CommitResearchUpdateInput;
  logs?: LogsJson;
  now?: Date;
  narrative: NarrativeJson;
}): ResearcherCommitResult {
  const now = params.now?.toISOString() ?? new Date().toISOString();
  const logs = params.logs ?? create_empty_logs();
  const narrative = structuredClone(params.narrative);

  // 1. Handle Expiry
  if (narrative.timestamps.expires_at && new Date(now).getTime() >= new Date(narrative.timestamps.expires_at).getTime()) {
    narrative.status = 'EXPIRED';
    narrative.timestamps.updated_at = now;
    const log_entry = buildAuditLog({ event_updates: [], narrative, now, top_level_message: 'Narrative expired before event-level evidence updates were applied.' });
    logs.entries.push(log_entry);
    return { event_updates: [], log_entry, logs, narrative };
  }

  // 2. Handle Global Failure
  const narrative_level_failure = params.input.evidence_items.find((item) => shouldFailNarrative(item));
  if (narrative_level_failure) {
    narrative.status = 'FAILED';
    narrative.timestamps.updated_at = now;
    const event_updates = applyEpistemicWipe(narrative);
    const log_entry = buildAuditLog({
      event_updates,
      narrative,
      now,
      top_level_message: `Narrative failed because: ${narrative_level_failure.summary ?? narrative_level_failure.source_ref}. AGM Belief Contraction executed.`,
    });
    logs.entries.push(log_entry);
    return { event_updates, log_entry, logs, narrative };
  }

  // 3. Process Events Topologically
  const event_updates: ResearcherEventUpdateSummary[] = [];
  const event_items = params.input.evidence_items.filter((item) => item.target_type === 'EVENT');
  const probability_shifts = new Map<string, { old_p: number; new_p: number; uncertainty: number }>();

  for (const event of topologicalSort(narrative.events)) {
    if (event.status !== 'PENDING') {
      probability_shifts.set(event.event_id, { old_p: event.probability, new_p: event.probability, uncertainty: event.uncertainty });
      continue;
    }

    const relevant_items = event_items.filter((item) => item.target_id === event.event_id);

    // Synthesize Propagation Items
    const phantom_items: ResearcherEvidenceItem[] = [];
    for (const dep of event.depends_on) {
      const shift = probability_shifts.get(dep.parent_event);
      if (shift) {
        const phantom = synthesizePropagationEvidence(
          shift.new_p - shift.old_p,
          shift.uncertainty,
          dep.type,
          dep.weight ?? 1.0,
          event.event_id,
          dep.parent_event
        );
        if (phantom) phantom_items.push(phantom);
      }
    }

    if (relevant_items.length === 0 && phantom_items.length === 0) {
      probability_shifts.set(event.event_id, { old_p: event.probability, new_p: event.probability, uncertainty: event.uncertainty });
      continue;
    }

    const all_items = [...relevant_items, ...phantom_items];
    const old_probability = event.probability;
    const old_conviction = event.conviction;
    const old_status = event.status;

    const has_decisive_true = relevant_items.some((item) => item.update_mode === 'DECISIVE_RESOLUTION' && item.resolution_hint === 'DECISIVE_TRUE');
    const has_decisive_false = relevant_items.some((item) => item.update_mode === 'DECISIVE_RESOLUTION' && item.resolution_hint === 'DECISIVE_FALSE');

    if (has_decisive_true) resolveEventState(event, 'RESOLVED_TRUE');
    else if (has_decisive_false) resolveEventState(event, 'RESOLVED_FALSE');
    else {
      let opinion = getCurrentOpinion(event);
      for (const item of all_items) {
        if (item.update_mode !== 'ORDINARY') continue;
        const evidence = deriveEvidenceOpinion(item, opinion.base_rate);
        opinion = clamp(item.duplicate_risk) >= DUPLICATE_RISK_THRESHOLD
          ? averagingBeliefFusion(opinion, evidence)
          : cumulativeBeliefFusion(opinion, evidence);
      }

      event.belief = opinion.belief;
      event.disbelief = opinion.disbelief;
      event.uncertainty = opinion.uncertainty;
      event.base_rate = opinion.base_rate;
      event.probability = deriveProbability(opinion);
      event.conviction = deriveConviction(opinion);

      const resolution_hint = relevant_items.find((item) => item.resolution_hint !== 'NONE')?.resolution_hint;
      const resolved = (resolution_hint ? maybeResolveByHint({ conviction: event.conviction, hint: resolution_hint, probability: event.probability }) : null)
        ?? maybeResolveByThresholds({ conviction: event.conviction, probability: event.probability });

      if (resolved) resolveEventState(event, resolved);
    }

    probability_shifts.set(event.event_id, { old_p: old_probability, new_p: event.probability, uncertainty: event.uncertainty });

    event_updates.push({
      evidence_count: all_items.length,
      event_id: event.event_id,
      new_conviction: event.conviction,
      new_probability: event.probability,
      new_status: event.status,
      old_conviction,
      old_probability,
      old_status,
      summary_items: all_items.map((item) => item.summary ?? item.source_ref),
    });
  }

  narrative.timestamps.updated_at = now;
  const log_entry = buildAuditLog({ event_updates, narrative, now, top_level_message: 'Applied structured research evidence to the narrative.' });
  logs.entries.push(log_entry);

  return { event_updates, log_entry, logs, narrative };
}

import { randomUUID } from "crypto";

import type {
  NarrativeJson,
  NarrativeEvent,
  NarrativeEventDependency,
} from "../../domain/narrative/schema";
import type { CompileNarrativeInput } from "./schema";

/**
 * Runtime metadata injected while materializing a compiled narrative.
 */
export interface CompileNarrativeContext {
  narrator_id: string;
  source_conversation_id: string;
}

/**
 * Stored compiler output record.
 */
export interface CompilerNarrativeRecord {
  source_conversation_id: string;
  narrative: NarrativeJson;
}

/**
 * Persistence contract for compiler outputs.
 */
export interface CompilerNarrativeRepository {
  saveNarrative(record: CompilerNarrativeRecord): Promise<void>;
}

/**
 * Simple in-memory repository used for tests and local scaffolding.
 */
export class InMemoryCompilerNarrativeRepository
  implements CompilerNarrativeRepository
{
  private readonly records = new Map<string, CompilerNarrativeRecord>();

  async saveNarrative(record: CompilerNarrativeRecord): Promise<void> {
    this.records.set(record.narrative.narrative_id, record);
  }

  getNarrative(narrative_id: string): CompilerNarrativeRecord | undefined {
    return this.records.get(narrative_id);
  }
}

/**
 * Derive the initial runtime event status from dependency structure.
 *
 * Events gated by unlock dependencies start `LOCKED`; everything else starts
 * `PENDING`.
 */
function derive_initial_event_status(
  depends_on: NarrativeEventDependency[],
): NarrativeEvent["status"] {
  const has_unlock_dependency = depends_on.some(
    (dependency) =>
      dependency.type === "UNLOCK_IF_TRUE" ||
      dependency.type === "UNLOCK_IF_FALSE",
  );

  return has_unlock_dependency ? "LOCKED" : "PENDING";
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function derive_initial_opinion(params: {
  conviction: number;
  probability: number;
}) {
  const probability = clamp(params.probability);
  const conviction = clamp(params.conviction);
  const uncertainty = 1 - conviction;
  const base_rate = probability;
  const belief = probability * conviction;
  const disbelief = (1 - probability) * conviction;

  return {
    base_rate,
    belief,
    conviction,
    disbelief,
    probability,
    uncertainty,
  };
}

/**
 * Convert validated compiler tool input into the persisted `NarrativeJson`
 * document used by the runtime system.
 */
export function materialize_narrative_json(
  input: CompileNarrativeInput,
  context: CompileNarrativeContext,
): NarrativeJson {
  const now = new Date().toISOString();

  return {
    narrative_id: randomUUID(),
    narrator_id: context.narrator_id,
    title: input.title,
    status: "ACTIVE",
    thesis_text: input.thesis_text,
    failure_conditions: input.failure_conditions,
    timestamps: {
      created_at: now,
      updated_at: now,
      expires_at: input.expires_at,
    },
    // Event runtime status is derived here rather than emitted by the compiler model.
    events: input.events.map((event) => ({
      ...derive_initial_opinion({
        conviction: event.conviction,
        probability: event.probability,
      }),
      event_id: event.event_id,
      label: event.label,
      status: derive_initial_event_status(event.depends_on),
      narrative_weight: event.narrative_weight,
      depends_on: event.depends_on,
    })),
  };
}

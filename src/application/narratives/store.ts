import type { NarrativeJson } from '../../domain/narrative/schema';

export interface NarrativeRecord {
  compiler_thread_id?: string;
  created_at: string;
  narrative: NarrativeJson;
  owner_id: string;
  updated_at: string;
  workspace_id?: string;
}

export interface NarrativeStore {
  attachWorkspace(params: {
    narrative_id: string;
    workspace_id: string;
  }): Promise<NarrativeRecord>;
  getNarrative(narrative_id: string): Promise<NarrativeRecord | null>;
  saveNarrative(record: NarrativeRecord): Promise<NarrativeRecord>;
}

export class InMemoryNarrativeStore implements NarrativeStore {
  private readonly narratives = new Map<string, NarrativeRecord>();

  async attachWorkspace(params: {
    narrative_id: string;
    workspace_id: string;
  }): Promise<NarrativeRecord> {
    const existing = this.narratives.get(params.narrative_id);

    if (!existing) {
      throw new Error(
        `Narrative "${params.narrative_id}" was not found.`,
      );
    }

    const updated: NarrativeRecord = {
      ...existing,
      updated_at: new Date().toISOString(),
      workspace_id: params.workspace_id,
    };
    this.narratives.set(params.narrative_id, updated);
    return structuredClone(updated);
  }

  async getNarrative(
    narrative_id: string,
  ): Promise<NarrativeRecord | null> {
    const record = this.narratives.get(narrative_id);
    return record ? structuredClone(record) : null;
  }

  async saveNarrative(record: NarrativeRecord): Promise<NarrativeRecord> {
    this.narratives.set(record.narrative.narrative_id, structuredClone(record));
    return structuredClone(record);
  }
}

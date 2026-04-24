import { narrative_json_schema } from '../../domain/narrative/schema';
import {
  NotFoundError,
} from '../common/errors';
import type {
  NarrativeRecord,
  NarrativeStore,
} from './store';

export interface NarrativeServiceParams {
  narrative_store: NarrativeStore;
}

export class NarrativeService {
  private readonly narrative_store: NarrativeStore;

  constructor(params: NarrativeServiceParams) {
    this.narrative_store = params.narrative_store;
  }

  async getNarrative(
    narrative_id: string,
    owner_id: string,
  ): Promise<NarrativeRecord> {
    return this.requireOwnedNarrative({
      narrative_id,
      owner_id,
    });
  }

  async listNarratives(owner_id: string): Promise<NarrativeRecord[]> {
    return this.narrative_store.listByOwner(owner_id);
  }

  async importNarrative(input: {
    compiler_thread_id?: string;
    narrative: unknown;
    owner_id: string;
  }) {
    const narrative = narrative_json_schema.parse(input.narrative);
    const now = new Date().toISOString();

    return this.narrative_store.saveNarrative({
      compiler_thread_id: input.compiler_thread_id,
      created_at: now,
      narrative,
      owner_id: input.owner_id,
      updated_at: now,
    });
  }

  private async requireOwnedNarrative(params: {
    narrative_id: string;
    owner_id: string;
  }): Promise<NarrativeRecord> {
    const record = await this.narrative_store.getNarrative(
      params.narrative_id,
    );

    if (!record) {
      throw new NotFoundError(
        `Narrative "${params.narrative_id}" was not found.`,
      );
    }

    if (record.owner_id !== params.owner_id) {
      throw new NotFoundError(
        `Narrative "${params.narrative_id}" was not found.`,
      );
    }

    return record;
  }
}

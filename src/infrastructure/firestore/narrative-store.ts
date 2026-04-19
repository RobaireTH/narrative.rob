import type { Firestore } from '@google-cloud/firestore';

import type {
  NarrativeRecord,
  NarrativeStore,
} from '../../application/narratives/store';

export interface FirestoreNarrativeStoreParams {
  collection_name?: string;
  firestore: Firestore;
}

export class FirestoreNarrativeStore implements NarrativeStore {
  private readonly collection_name: string;
  private readonly firestore: Firestore;

  constructor(params: FirestoreNarrativeStoreParams) {
    this.collection_name = params.collection_name ?? 'narratives';
    this.firestore = params.firestore;
  }

  private collection() {
    return this.firestore.collection(this.collection_name);
  }

  async attachWorkspace(params: {
    narrative_id: string;
    workspace_id: string;
  }): Promise<NarrativeRecord> {
    const existing = await this.getNarrative(params.narrative_id);

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
    await this.collection().doc(params.narrative_id).set(updated);
    return updated;
  }

  async getNarrative(
    narrative_id: string,
  ): Promise<NarrativeRecord | null> {
    const snapshot = await this.collection().doc(narrative_id).get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as NarrativeRecord;
  }

  async saveNarrative(record: NarrativeRecord): Promise<NarrativeRecord> {
    await this.collection().doc(record.narrative.narrative_id).set(record);
    return record;
  }
}

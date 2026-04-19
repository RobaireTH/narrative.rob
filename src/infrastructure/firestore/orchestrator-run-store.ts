import type { Firestore } from '@google-cloud/firestore';

import type {
  OrchestratorRunRecord,
  OrchestratorRunStore,
} from '../../application/orchestrator/run-store';

export interface FirestoreOrchestratorRunStoreParams {
  collection_name?: string;
  firestore: Firestore;
}

export class FirestoreOrchestratorRunStore
  implements OrchestratorRunStore
{
  private readonly collection_name: string;
  private readonly firestore: Firestore;

  constructor(params: FirestoreOrchestratorRunStoreParams) {
    this.collection_name = params.collection_name ?? 'orchestrator_runs';
    this.firestore = params.firestore;
  }

  private collection() {
    return this.firestore.collection(this.collection_name);
  }

  async getLatestRunByThread(
    thread_id: string,
  ): Promise<OrchestratorRunRecord | null> {
    const snapshot = await this.collection()
      .where('thread_id', '==', thread_id)
      .orderBy('started_at', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return snapshot.docs[0].data() as OrchestratorRunRecord;
  }

  async saveRun(record: OrchestratorRunRecord): Promise<OrchestratorRunRecord> {
    await this.collection().doc(record.run_id).set(record);
    return record;
  }
}

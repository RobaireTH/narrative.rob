import type { Firestore } from '@google-cloud/firestore';

import type {
  OrchestratorScheduleRecord,
  OrchestratorScheduleStore,
} from '../../application/orchestrator/schedule-store';

export interface FirestoreOrchestratorScheduleStoreParams {
  collection_name?: string;
  firestore: Firestore;
}

export class FirestoreOrchestratorScheduleStore
  implements OrchestratorScheduleStore
{
  private readonly collection_name: string;
  private readonly firestore: Firestore;

  constructor(params: FirestoreOrchestratorScheduleStoreParams) {
    this.collection_name =
      params.collection_name ?? 'orchestrator_schedules';
    this.firestore = params.firestore;
  }

  private collection() {
    return this.firestore.collection(this.collection_name);
  }

  async findDueSchedules(
    now_iso: string,
  ): Promise<OrchestratorScheduleRecord[]> {
    const snapshot = await this.collection()
      .where('status', '==', 'active')
      .where('next_run_at', '<=', now_iso)
      .get();

    return snapshot.docs.map((doc) => doc.data() as OrchestratorScheduleRecord);
  }

  async getSchedule(
    thread_id: string,
  ): Promise<OrchestratorScheduleRecord | null> {
    const snapshot = await this.collection().doc(thread_id).get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as OrchestratorScheduleRecord;
  }

  async saveSchedule(
    record: OrchestratorScheduleRecord,
  ): Promise<OrchestratorScheduleRecord> {
    await this.collection().doc(record.thread_id).set(record);
    return record;
  }
}

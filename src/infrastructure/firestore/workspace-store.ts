import type { Firestore } from '@google-cloud/firestore';

import type {
  WorkspaceRecord,
  WorkspaceStore,
} from '../../application/workspaces/store';

export interface FirestoreWorkspaceStoreParams {
  collection_name?: string;
  firestore: Firestore;
}

export class FirestoreWorkspaceStore implements WorkspaceStore {
  private readonly collection_name: string;
  private readonly firestore: Firestore;

  constructor(params: FirestoreWorkspaceStoreParams) {
    this.collection_name = params.collection_name ?? 'workspaces';
    this.firestore = params.firestore;
  }

  private collection() {
    return this.firestore.collection(this.collection_name);
  }

  async getWorkspace(
    workspace_id: string,
  ): Promise<WorkspaceRecord | null> {
    const snapshot = await this.collection().doc(workspace_id).get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as WorkspaceRecord;
  }

  async getWorkspaceByThread(
    thread_id: string,
  ): Promise<WorkspaceRecord | null> {
    const snapshot = await this.collection()
      .where('thread_id', '==', thread_id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return snapshot.docs[0].data() as WorkspaceRecord;
  }

  async listByOwner(owner_id: string): Promise<WorkspaceRecord[]> {
    const snapshot = await this.collection()
      .where('owner_id', '==', owner_id)
      .orderBy('updated_at', 'desc')
      .get();

    return snapshot.docs.map((doc) => doc.data() as WorkspaceRecord);
  }

  async saveWorkspace(record: WorkspaceRecord): Promise<WorkspaceRecord> {
    await this.collection().doc(record.workspace_id).set(record);
    return record;
  }
}

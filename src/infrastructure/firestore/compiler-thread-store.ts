import { randomUUID } from 'crypto';

import type { Firestore } from '@google-cloud/firestore';

import {
  type CompilerThreadMessage,
  type CompilerThreadRecord,
  type CompilerThreadStore,
  type CreateCompilerThreadInput,
} from '../../application/compiler/thread-store';
import { NotFoundError } from '../../application/common/errors';

export interface FirestoreCompilerThreadStoreParams {
  collection_name?: string;
  firestore: Firestore;
}

export class FirestoreCompilerThreadStore implements CompilerThreadStore {
  private readonly collection_name: string;
  private readonly firestore: Firestore;

  constructor(params: FirestoreCompilerThreadStoreParams) {
    this.collection_name =
      params.collection_name ?? 'compiler_threads';
    this.firestore = params.firestore;
  }

  private collection() {
    return this.firestore.collection(this.collection_name);
  }

  async appendMessage(params: {
    message: CompilerThreadMessage;
    thread_id: string;
  }): Promise<CompilerThreadRecord> {
    const existing = await this.getThread(params.thread_id);

    if (!existing) {
      throw new NotFoundError(
        `Compiler thread "${params.thread_id}" was not found.`,
      );
    }

    const updated: CompilerThreadRecord = {
      ...existing,
      messages: [...existing.messages, params.message],
      updated_at: params.message.created_at,
    };

    await this.collection().doc(params.thread_id).set(updated);
    return updated;
  }

  async createThread(
    input: CreateCompilerThreadInput,
  ): Promise<CompilerThreadRecord> {
    const now = new Date().toISOString();
    const thread: CompilerThreadRecord = {
      created_at: now,
      messages: [],
      narrator_id: input.narrator_id,
      owner_id: input.owner_id,
      runtime_mode: input.runtime_mode,
      source_conversation_id:
        input.source_conversation_id ?? randomUUID(),
      status: 'READY',
      thread_id: randomUUID(),
      updated_at: now,
    };

    await this.collection().doc(thread.thread_id).set(thread);
    return thread;
  }

  async getThread(thread_id: string): Promise<CompilerThreadRecord | null> {
    const snapshot = await this.collection().doc(thread_id).get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as CompilerThreadRecord;
  }

  async listByOwner(owner_id: string): Promise<CompilerThreadRecord[]> {
    const snapshot = await this.collection()
      .where('owner_id', '==', owner_id)
      .orderBy('updated_at', 'desc')
      .get();

    return snapshot.docs.map((doc) => doc.data() as CompilerThreadRecord);
  }

  async updateThread(params: {
    patch: Partial<Omit<CompilerThreadRecord, 'thread_id' | 'messages'>>;
    thread_id: string;
  }): Promise<CompilerThreadRecord> {
    const existing = await this.getThread(params.thread_id);

    if (!existing) {
      throw new NotFoundError(
        `Compiler thread "${params.thread_id}" was not found.`,
      );
    }

    const updated: CompilerThreadRecord = {
      ...existing,
      ...params.patch,
      updated_at:
        params.patch.updated_at ?? new Date().toISOString(),
    };

    await this.collection().doc(params.thread_id).set(updated);
    return updated;
  }
}

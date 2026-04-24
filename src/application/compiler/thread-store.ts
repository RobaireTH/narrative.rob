import { randomUUID } from 'crypto';

import { NotFoundError } from '../common/errors';

export const compiler_thread_statuses = [
  'AWAITING_AI_RUNTIME',
  'AWAITING_APPROVAL',
  'COMPILED',
  'FAILED',
  'READY',
] as const;

export type CompilerThreadStatus =
  (typeof compiler_thread_statuses)[number];

export const compiler_message_roles = [
  'assistant',
  'system',
  'user',
] as const;

export type CompilerMessageRole = (typeof compiler_message_roles)[number];

export interface CompilerThreadMessage {
  content: string;
  created_at: string;
  message_id: string;
  role: CompilerMessageRole;
}

export interface CompilerThreadRecord {
  created_at: string;
  messages: CompilerThreadMessage[];
  narrator_id: string;
  owner_id: string;
  runtime_mode: string;
  source_conversation_id: string;
  status: CompilerThreadStatus;
  thread_id: string;
  updated_at: string;
}

export interface CreateCompilerThreadInput {
  narrator_id: string;
  owner_id: string;
  runtime_mode: string;
  source_conversation_id?: string;
}

export interface CompilerThreadStore {
  appendMessage(params: {
    message: CompilerThreadMessage;
    thread_id: string;
  }): Promise<CompilerThreadRecord>;
  createThread(input: CreateCompilerThreadInput): Promise<CompilerThreadRecord>;
  getThread(thread_id: string): Promise<CompilerThreadRecord | null>;
  listByOwner(owner_id: string): Promise<CompilerThreadRecord[]>;
  updateThread(params: {
    patch: Partial<Omit<CompilerThreadRecord, 'thread_id' | 'messages'>>;
    thread_id: string;
  }): Promise<CompilerThreadRecord>;
}

function cloneThread(thread: CompilerThreadRecord): CompilerThreadRecord {
  return {
    ...thread,
    messages: thread.messages.map((message) => ({
      ...message,
    })),
  };
}

export class InMemoryCompilerThreadStore implements CompilerThreadStore {
  private readonly threads = new Map<string, CompilerThreadRecord>();

  async appendMessage(params: {
    message: CompilerThreadMessage;
    thread_id: string;
  }): Promise<CompilerThreadRecord> {
    const existing = this.threads.get(params.thread_id);

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
    this.threads.set(params.thread_id, updated);
    return cloneThread(updated);
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

    this.threads.set(thread.thread_id, thread);
    return cloneThread(thread);
  }

  async getThread(thread_id: string): Promise<CompilerThreadRecord | null> {
    const thread = this.threads.get(thread_id);
    return thread ? cloneThread(thread) : null;
  }

  async listByOwner(owner_id: string): Promise<CompilerThreadRecord[]> {
    return Array.from(this.threads.values())
      .filter((thread) => thread.owner_id === owner_id)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((thread) => cloneThread(thread));
  }

  async updateThread(params: {
    patch: Partial<Omit<CompilerThreadRecord, 'thread_id' | 'messages'>>;
    thread_id: string;
  }): Promise<CompilerThreadRecord> {
    const existing = this.threads.get(params.thread_id);

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
    this.threads.set(params.thread_id, updated);
    return cloneThread(updated);
  }
}

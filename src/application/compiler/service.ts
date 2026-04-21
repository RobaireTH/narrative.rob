import { randomUUID } from 'crypto';
import type { Logger } from 'pino';

import {
  NotImplementedAppError,
  NotFoundError,
  ValidationAppError,
} from '../common/errors';
import type { NarrativeStore } from '../narratives/store';
import { LangGraphCompilerRuntime } from './langgraph-runtime';
import {
  type CompilerThreadRecord,
  type CompilerThreadStore,
} from './thread-store';

export type CompilerRuntimeMode = 'disabled' | 'langgraph';

export interface CompilerServiceParams {
  anthropic_api_key?: string;
  logger: Logger;
  model_id: string;
  narrative_store: NarrativeStore;
  redis_ttl_minutes: number;
  redis_url?: string;
  runtime_mode: CompilerRuntimeMode;
  thread_store: CompilerThreadStore;
}

export class CompilerService {
  private readonly logger: Logger;
  private readonly model_id: string;
  private readonly narrative_store: NarrativeStore;
  private readonly runtime_mode: CompilerRuntimeMode;
  private readonly runtime?: LangGraphCompilerRuntime;
  private readonly thread_store: CompilerThreadStore;

  constructor(params: CompilerServiceParams) {
    this.logger = params.logger;
    this.model_id = params.model_id;
    this.narrative_store = params.narrative_store;
    this.runtime_mode = params.runtime_mode;
    this.thread_store = params.thread_store;

    if (params.runtime_mode === 'langgraph') {
      if (!params.anthropic_api_key) {
        throw new Error(
          'COMPILER_RUNTIME_MODE=langgraph requires ANTHROPIC_API_KEY to be set.',
        );
      }
      if (!params.redis_url) {
        throw new Error(
          'COMPILER_RUNTIME_MODE=langgraph requires REDIS_URL to be set.',
        );
      }

      this.runtime = new LangGraphCompilerRuntime({
        anthropic_api_key: params.anthropic_api_key,
        logger: params.logger,
        model_id: params.model_id,
        narrative_store: params.narrative_store,
        redis_ttl_minutes: params.redis_ttl_minutes,
        redis_url: params.redis_url,
      });
    }
  }

  async approveThread(params: {
    owner_id: string;
    thread_id: string;
  }) {
    const thread = await this.requireOwnedThread({
      owner_id: params.owner_id,
      thread_id: params.thread_id,
    });

    if (!this.runtime || this.runtime_mode !== 'langgraph') {
      throw new NotImplementedAppError(
        'Compiler approval is blocked because the AI runtime adapter is not wired yet.',
        {
          model_id: this.model_id,
          runtime_mode: thread.runtime_mode,
          thread_id: params.thread_id,
        },
      );
    }

    if (thread.status !== 'AWAITING_APPROVAL') {
      throw new ValidationAppError(
        `Compiler thread is in status "${thread.status}" and cannot be approved.`,
        { thread_id: params.thread_id },
      );
    }

    const result = await this.runtime.approveThread({
      narrator_id: thread.narrator_id,
      owner_id: thread.owner_id,
      source_conversation_id: thread.source_conversation_id,
      thread_id: thread.thread_id,
    });

    const now = new Date().toISOString();
    for (const content of result.assistant_messages) {
      await this.thread_store.appendMessage({
        message: {
          content,
          created_at: now,
          message_id: randomUUID(),
          role: 'assistant',
        },
        thread_id: thread.thread_id,
      });
    }

    if (result.compiled_narrative) {
      this.logger.info(
        {
          narrative_id: result.compiled_narrative.narrative.narrative_id,
          thread_id: thread.thread_id,
        },
        'compiler narrative persisted',
      );

      return this.thread_store.updateThread({
        patch: {
          status: 'COMPILED',
          updated_at: new Date().toISOString(),
        },
        thread_id: thread.thread_id,
      });
    }

    return this.thread_store.updateThread({
      patch: {
        status: result.awaiting_confirmation ? 'AWAITING_APPROVAL' : 'READY',
        updated_at: new Date().toISOString(),
      },
      thread_id: thread.thread_id,
    });
  }

  async createThread(input: {
    narrator_id: string;
    owner_id: string;
    source_conversation_id?: string;
  }) {
    return this.thread_store.createThread({
      ...input,
      runtime_mode: this.runtime_mode,
    });
  }

  async getThread(params: {
    owner_id: string;
    thread_id: string;
  }) {
    return this.requireOwnedThread({
      owner_id: params.owner_id,
      thread_id: params.thread_id,
    });
  }

  async postUserMessage(params: {
    content: string;
    owner_id: string;
    thread_id: string;
  }) {
    const thread = await this.requireOwnedThread({
      owner_id: params.owner_id,
      thread_id: params.thread_id,
    });
    const now = new Date().toISOString();

    const with_user_message = await this.thread_store.appendMessage({
      message: {
        content: params.content,
        created_at: now,
        message_id: randomUUID(),
        role: 'user',
      },
      thread_id: params.thread_id,
    });

    if (this.runtime_mode === 'disabled' || !this.runtime) {
      const updated = await this.thread_store.appendMessage({
        message: {
          content:
            'Compiler thread created and message captured, but the AI runtime adapter is not configured yet. Backend persistence is ready; model execution is the next integration point.',
          created_at: new Date().toISOString(),
          message_id: randomUUID(),
          role: 'system',
        },
        thread_id: params.thread_id,
      });

      return this.thread_store.updateThread({
        patch: {
          status: 'AWAITING_AI_RUNTIME',
          updated_at: updated.updated_at,
        },
        thread_id: updated.thread_id,
      });
    }

    const result = await this.runtime.postUserMessage({
      content: params.content,
      narrator_id: thread.narrator_id,
      owner_id: thread.owner_id,
      source_conversation_id: thread.source_conversation_id,
      thread_id: thread.thread_id,
    });

    for (const content of result.assistant_messages) {
      await this.thread_store.appendMessage({
        message: {
          content,
          created_at: new Date().toISOString(),
          message_id: randomUUID(),
          role: 'assistant',
        },
        thread_id: thread.thread_id,
      });
    }

    if (result.compiled_narrative) {
      return this.thread_store.updateThread({
        patch: {
          status: 'COMPILED',
          updated_at: new Date().toISOString(),
        },
        thread_id: thread.thread_id,
      });
    }

    return this.thread_store.updateThread({
      patch: {
        status: result.awaiting_confirmation ? 'AWAITING_APPROVAL' : 'READY',
        updated_at: new Date().toISOString(),
      },
      thread_id: with_user_message.thread_id,
    });
  }

  getRuntimeMode(): CompilerRuntimeMode {
    return this.runtime_mode;
  }

  getModelId(): string {
    return this.model_id;
  }

  getNarrativeStore(): NarrativeStore {
    return this.narrative_store;
  }

  private async requireOwnedThread(params: {
    owner_id?: string;
    thread_id: string;
  }): Promise<CompilerThreadRecord> {
    const thread_id = params.thread_id;
    const thread = await this.thread_store.getThread(thread_id);

    if (!thread) {
      throw new NotFoundError(
        `Compiler thread "${thread_id}" was not found.`,
      );
    }

    if (params.owner_id && thread.owner_id !== params.owner_id) {
      throw new NotFoundError(
        `Compiler thread "${thread_id}" was not found.`,
      );
    }

    return thread;
  }
}

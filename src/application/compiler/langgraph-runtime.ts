import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { Logger } from 'pino';

import {
  create_compiler_agent_graph,
  create_compiler_resume_command,
} from '../../agents/compiler/graph';
import type {
  CompileNarrativeContext,
  CompilerNarrativeRecord,
  CompilerNarrativeRepository,
} from '../../agents/compiler/repository';
import { create_compiler_redis_checkpointer } from '../../agents/compiler/checkpointer';
import { UpstreamUnavailableError } from '../common/errors';
import type { NarrativeRecord, NarrativeStore } from '../narratives/store';

export interface LangGraphCompilerRuntimeParams {
  anthropic_api_key: string;
  logger: Logger;
  model_id: string;
  narrative_store: NarrativeStore;
  redis_ttl_minutes: number;
  redis_url: string;
}

export interface CompilerStepInput {
  content: string;
  narrator_id: string;
  owner_id: string;
  source_conversation_id: string;
  thread_id: string;
}

export interface CompilerApprovalInput {
  narrator_id: string;
  owner_id: string;
  source_conversation_id: string;
  thread_id: string;
}

export interface CompilerStepResult {
  assistant_messages: string[];
  awaiting_confirmation: boolean;
  compiled_narrative?: NarrativeRecord;
}

function extract_text(content: BaseMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('')
    .trim();
}

class CapturingCompilerRepository implements CompilerNarrativeRepository {
  public captured?: CompilerNarrativeRecord;

  async saveNarrative(record: CompilerNarrativeRecord): Promise<void> {
    this.captured = record;
  }
}

export class LangGraphCompilerRuntime {
  private readonly logger: Logger;
  private readonly model: ChatAnthropic;
  private readonly narrative_store: NarrativeStore;
  private readonly redis_ttl_minutes: number;
  private readonly redis_url: string;
  private checkpointer_promise?: Promise<BaseCheckpointSaver>;

  constructor(params: LangGraphCompilerRuntimeParams) {
    this.logger = params.logger;
    this.narrative_store = params.narrative_store;
    this.redis_ttl_minutes = params.redis_ttl_minutes;
    this.redis_url = params.redis_url;
    this.model = new ChatAnthropic({
      apiKey: params.anthropic_api_key,
      model: params.model_id,
      temperature: 0.2,
    });
  }

  async postUserMessage(input: CompilerStepInput): Promise<CompilerStepResult> {
    return this.runStep({
      input,
      payload: new HumanMessage(input.content),
    });
  }

  async approveThread(input: CompilerApprovalInput): Promise<CompilerStepResult> {
    return this.runStep({
      input,
      payload: create_compiler_resume_command('yes'),
    });
  }

  private async getCheckpointer(): Promise<BaseCheckpointSaver> {
    if (!this.checkpointer_promise) {
      this.checkpointer_promise = create_compiler_redis_checkpointer({
        redis_url: this.redis_url,
        ttl_minutes: this.redis_ttl_minutes,
      });
    }
    return this.checkpointer_promise;
  }

  private async runStep(args: {
    input: CompilerStepInput | CompilerApprovalInput;
    payload: HumanMessage | ReturnType<typeof create_compiler_resume_command>;
  }): Promise<CompilerStepResult> {
    const context: CompileNarrativeContext = {
      narrator_id: args.input.narrator_id,
      source_conversation_id: args.input.source_conversation_id,
    };
    const repository = new CapturingCompilerRepository();
    const checkpointer = await this.getCheckpointer();
    const graph = create_compiler_agent_graph({
      checkpointer,
      context,
      model: this.model,
      repository,
    });

    const config = {
      configurable: {
        thread_id: args.input.thread_id,
      },
    };

    let final_state;
    try {
      if (args.payload instanceof HumanMessage) {
        final_state = await graph.invoke(
          {
            messages: [args.payload],
          },
          config,
        );
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        final_state = await graph.invoke(args.payload as any, config);
      }
    } catch (error) {
      this.logger.error(
        {
          err: error,
          thread_id: args.input.thread_id,
        },
        'compiler graph invocation failed',
      );
      throw new UpstreamUnavailableError(
        error instanceof Error ? error.message : 'Compiler runtime failed.',
        {
          runtime: 'langgraph',
          thread_id: args.input.thread_id,
        },
      );
    }

    const messages = (final_state.messages ?? []) as BaseMessage[];
    const last_human_index = [...messages]
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.type === 'human')
      .at(-1)?.index;
    const new_messages = messages.slice(
      typeof last_human_index === 'number' ? last_human_index + 1 : 0,
    );
    const assistant_messages = new_messages
      .filter((message): message is AIMessage => message.type === 'ai')
      .map((message) => extract_text(message.content))
      .filter((text) => text.length > 0);

    let compiled_narrative: NarrativeRecord | undefined;
    if (repository.captured) {
      const now = new Date().toISOString();
      compiled_narrative = await this.narrative_store.saveNarrative({
        compiler_thread_id: args.input.thread_id,
        created_at: now,
        narrative: repository.captured.narrative,
        owner_id: args.input.owner_id,
        updated_at: now,
      });
    }

    return {
      assistant_messages,
      awaiting_confirmation: Boolean(final_state.awaiting_confirmation),
      compiled_narrative,
    };
  }
}

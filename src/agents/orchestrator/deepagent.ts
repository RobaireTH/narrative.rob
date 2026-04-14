import {
  createDeepAgent,
  StateBackend,
  type CreateDeepAgentParams,
} from 'deepagents';
import { z } from 'zod';

import { orchestrator_agent_system_prompt } from './prompt';

/**
 * Per-invocation context for the orchestrator Deep Agent.
 *
 * The orchestrator uses this for runtime metadata like workspace identity
 * and trigger source rather than for persistent state.
 */
export const orchestrator_context_schema = z.object({
  narrativeId: z.string().optional(),
  runReason: z
    .enum(['cron', 'manual', 'queue', 'webhook'])
    .optional(),
  workspaceId: z.string().optional(),
});

export interface CreateOrchestratorAgentParams {
  backend?: CreateDeepAgentParams['backend'];
  checkpointer?: CreateDeepAgentParams['checkpointer'];
  memory?: string[];
  model?: CreateDeepAgentParams['model'];
  name?: string;
  store?: CreateDeepAgentParams['store'];
  subagents: NonNullable<CreateDeepAgentParams['subagents']>;
  tools?: NonNullable<CreateDeepAgentParams['tools']>;
}

/**
 * Create the Deep Agent supervisor that coordinates researcher, portfolio
 * manager, and executor subagents over a shared workspace backend.
 */
export function createOrchestratorAgent(
  params: CreateOrchestratorAgentParams,
) {
  return createDeepAgent({
    backend: params.backend ?? new StateBackend(),
    ...(params.checkpointer !== undefined
      ? { checkpointer: params.checkpointer }
      : {}),
    contextSchema: orchestrator_context_schema,
    memory: params.memory,
    model: params.model,
    name: params.name ?? 'deep_orchestrator',
    store: params.store,
    subagents: params.subagents,
    systemPrompt: orchestrator_agent_system_prompt,
    tools: params.tools ?? [],
  });
}

import {
  createDeepAgent,
  StateBackend,
  type CreateDeepAgentParams,
  type SubAgent,
} from 'deepagents';
import { z } from 'zod';

import { contextual_researcher_system_prompt } from './prompt';
import { createContextualResearchToolsFromEnv, type ContextualResearchToolSet } from './tools';

/**
 * Per-invocation context for the contextual researcher Deep Agent.
 *
 * Context values are not persisted between runs and are intended for runtime
 * metadata like workspace identity or trigger source.
 */
export const contextual_researcher_context_schema = z.object({
  narrativeId: z.string().optional(),
  triggeredBy: z.string().optional(),
  workspaceId: z.string().optional(),
});

export interface CreateContextualResearcherAgentParams {
  backend?: CreateDeepAgentParams['backend'];
  checkpointer?: CreateDeepAgentParams['checkpointer'];
  memory?: string[];
  model?: CreateDeepAgentParams['model'];
  name?: string;
  store?: CreateDeepAgentParams['store'];
  tool_set?: ContextualResearchToolSet;
}

/**
 * Create the researcher as a Deep Agents `SubAgent` definition for use by the
 * orchestrator's built-in `task` tool.
 */
export function createContextualResearcherSubagent(
  params: Omit<CreateContextualResearcherAgentParams, 'backend' | 'checkpointer' | 'memory' | 'store'> = {},
): SubAgent {
  const backend = new StateBackend();
  const tool_set = params.tool_set ?? createContextualResearchToolsFromEnv(backend);

  return {
    description:
      'Evaluates outside-world evidence for PENDING narrative events and updates narrative.json while honoring the thesis trading mandate.',
    name: params.name ?? 'contextual_researcher',
    systemPrompt: contextual_researcher_system_prompt,
    tools: tool_set.tools,
    ...(params.model ? { model: params.model } : {}),
  };
}

/**
 * Create a standalone contextual researcher Deep Agent.
 *
 * This is useful when you want to run the researcher directly, while
 * `createContextualResearcherSubagent` is the orchestrator-facing form.
 */
export function createContextualResearcherAgent(
  params: CreateContextualResearcherAgentParams = {},
) {
  const backend = params.backend ?? new StateBackend();
  const tool_set = params.tool_set ?? createContextualResearchToolsFromEnv(backend);

  return createDeepAgent({
    backend,
    ...(params.checkpointer !== undefined
      ? { checkpointer: params.checkpointer }
      : {}),
    contextSchema: contextual_researcher_context_schema,
    memory: params.memory,
    model: params.model,
    name: params.name ?? 'contextual_researcher',
    store: params.store,
    systemPrompt: contextual_researcher_system_prompt,
    tools: tool_set.tools,
  });
}

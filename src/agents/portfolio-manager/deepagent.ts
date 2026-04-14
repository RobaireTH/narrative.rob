import {
  createDeepAgent,
  StateBackend,
  type CreateDeepAgentParams,
  type SubAgent,
} from 'deepagents';
import { z } from 'zod';

import { portfolio_manager_system_prompt } from './prompt';
import {
  createPortfolioManagerToolsFromEnv,
  createPortfolioManagerTools,
  type BaysePortfolioManagerClient,
  type PortfolioManagerToolSet,
} from './tools';

/**
 * Per-invocation context for the Portfolio Manager Deep Agent.
 */
export const portfolio_manager_context_schema = z.object({
  narrativeId: z.string().optional(),
  workspaceId: z.string().optional(),
});

/**
 * Construction parameters for the Portfolio Manager Deep Agent.
 */
export interface CreatePortfolioManagerAgentParams {
  backend?: CreateDeepAgentParams['backend'];
  bayse_client?: BaysePortfolioManagerClient;
  checkpointer?: CreateDeepAgentParams['checkpointer'];
  memory?: string[];
  model?: CreateDeepAgentParams['model'];
  name?: string;
  store?: CreateDeepAgentParams['store'];
  tool_set?: PortfolioManagerToolSet;
}

/**
 * Create the Portfolio Manager as a Deep Agents `SubAgent`.
 */
export function createPortfolioManagerSubagent(
  params: Omit<
    CreatePortfolioManagerAgentParams,
    'backend' | 'checkpointer' | 'memory' | 'store'
  > = {},
): SubAgent {
  const backend = new StateBackend();
  const tool_set = params.tool_set
    ?? (params.bayse_client
      ? createPortfolioManagerTools(params.bayse_client, backend)
      : createPortfolioManagerToolsFromEnv(backend));

  return {
    description:
      'Constructs a capital-allocation and market-routing plan from narrative.json, portfolio.json, and read-only Bayse market data.',
    name: params.name ?? 'portfolio_manager',
    systemPrompt: portfolio_manager_system_prompt,
    tools: tool_set.tools,
    ...(params.model ? { model: params.model } : {}),
  };
}

/**
 * Create a standalone Portfolio Manager Deep Agent.
 */
export function createPortfolioManagerAgent(
  params: CreatePortfolioManagerAgentParams = {},
) {
  const backend = params.backend ?? new StateBackend();
  const tool_set = params.tool_set
    ?? (params.bayse_client
      ? createPortfolioManagerTools(params.bayse_client, backend)
      : createPortfolioManagerToolsFromEnv(backend));

  return createDeepAgent({
    backend,
    ...(params.checkpointer !== undefined
      ? { checkpointer: params.checkpointer }
      : {}),
    contextSchema: portfolio_manager_context_schema,
    memory: params.memory,
    model: params.model,
    name: params.name ?? 'portfolio_manager',
    store: params.store,
    systemPrompt: portfolio_manager_system_prompt,
    tools: tool_set.tools,
  });
}

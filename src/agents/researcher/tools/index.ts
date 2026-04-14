import {
  StateBackend,
  type AnyBackendProtocol,
  type BackendFactory,
} from 'deepagents';
import { tool, type StructuredTool } from 'langchain';
import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';

import {
  CoinGeckoClient,
  coingecko_api_request_schema,
  coingecko_api_request_tool_description,
  resolveCoinGeckoClientConfig,
  type CoinGeckoApiRequest,
} from './coingecko';
import { createCommitResearchUpdateTool } from '../runtime';

export interface ContextualResearchToolSet {
  commit_research_update: StructuredTool;
  tools: StructuredTool[];
  unavailable: string[];
}

/**
 * Convert a typed async function into a LangChain structured tool.
 *
 * We serialize outputs to JSON text so the model always sees a predictable
 * string payload, even when the upstream API response shape varies.
 */
function createJsonTool<TInput>(params: {
  client_execute: (input: TInput) => Promise<unknown>;
  description: string;
  input_schema: z.ZodType<TInput>;
  name: string;
}): StructuredTool {
  return tool(
    async (input) => {
      // Validate the model-generated arguments before calling the client.
      const parsed = params.input_schema.parse(input);
      // Execute the underlying client operation.
      const result = await params.client_execute(parsed);
      // Return JSON text so downstream model behavior stays consistent.
      return JSON.stringify(result, null, 2);
    },
    {
      description: params.description,
      name: params.name,
      schema: params.input_schema,
    },
  );
}

/**
 * Create a Tavily tool specialized for recent news.
 */
export function createTavilyNewsSearchTool(params: {
  apiKey: string;
  maxResults?: number;
}): StructuredTool {
  // Reuse the official Tavily structured tool and pin it to the `news` topic.
  const toolInstance = new TavilySearch({
    maxResults: params.maxResults ?? 5,
    tavilyApiKey: params.apiKey,
    topic: 'news',
  });
  toolInstance.name = 'tavily_search_news';
  toolInstance.description =
    'Search recent news coverage with Tavily. Use this for current-event evidence, regulatory actions, mainstream reporting, and headline confirmation. Prefer this before broader web search when the thesis mandate is news-driven.';
  return toolInstance;
}

/**
 * Create a Tavily tool specialized for broader web context.
 */
export function createTavilyGeneralSearchTool(params: {
  apiKey: string;
  maxResults?: number;
}): StructuredTool {
  // Reuse the same official tool but pin it to the `general` topic.
  const toolInstance = new TavilySearch({
    maxResults: params.maxResults ?? 5,
    tavilyApiKey: params.apiKey,
    topic: 'general',
  });
  toolInstance.name = 'tavily_search_general';
  toolInstance.description =
    'Search broader web context with Tavily. Use this when the thesis requires non-news web evidence, background context, source discovery, or follow-up investigation beyond mainstream reporting.';
  return toolInstance;
}

/**
 * Create the dynamic CoinGecko request tool.
 *
 * The schema stays intentionally small so endpoint selection happens through
 * the tool description and the agent's reasoning rather than rigid endpoint
 * wrappers.
 */
export function createCoinGeckoApiRequestTool(
  client: Pick<CoinGeckoClient, 'request'>,
): StructuredTool {
  return createJsonTool<CoinGeckoApiRequest>({
    client_execute: (input) => client.request(input),
    description: coingecko_api_request_tool_description,
    input_schema: coingecko_api_request_schema,
    name: 'coingecko_api_request',
  });
}

/**
 * Build the full external toolset available to the researcher.
 *
 * Providers are optional. Missing providers are reported through `unavailable`
 * so agent creation can still succeed in partial environments.
 */
export function createContextualResearchTools(params?: {
  backend?: AnyBackendProtocol | BackendFactory;
  coingecko_client?: Pick<CoinGeckoClient, 'request'>;
  tavily_api_key?: string;
  tavily_max_results?: number;
}): ContextualResearchToolSet {
  const backend = params?.backend ?? new StateBackend();
  const tools: StructuredTool[] = [];
  const unavailable: string[] = [];
  const commit_research_update = createCommitResearchUpdateTool(backend);

  // Add Tavily-backed tools only when a Tavily API key is available.
  if (params?.tavily_api_key) {
    tools.push(
      createTavilyNewsSearchTool({
        apiKey: params.tavily_api_key,
        maxResults: params.tavily_max_results,
      }),
    );
    tools.push(
      createTavilyGeneralSearchTool({
        apiKey: params.tavily_api_key,
        maxResults: params.tavily_max_results,
      }),
    );
  } else {
    unavailable.push('tavily_search_news', 'tavily_search_general');
  }

  // Add the CoinGecko tool only when a client implementation is provided.
  if (params?.coingecko_client) {
    tools.push(createCoinGeckoApiRequestTool(params.coingecko_client));
  } else {
    unavailable.push('coingecko_api_request');
  }

  return {
    commit_research_update,
    tools: [
      ...tools,
      commit_research_update,
    ],
    unavailable,
  };
}

/**
 * Build the default researcher toolset directly from environment variables.
 */
export function createContextualResearchToolsFromEnv(
  backend: AnyBackendProtocol | BackendFactory = new StateBackend(),
  env: NodeJS.ProcessEnv = process.env,
): ContextualResearchToolSet {
  // Tavily is optional, so a missing key simply removes those tools.
  const tavily_api_key = env.TAVILY_API_KEY?.trim() || undefined;
  // CoinGecko always gets a client because it can run without auth in public mode.
  const coingecko_config = resolveCoinGeckoClientConfig(env);

  return createContextualResearchTools({
    backend,
    coingecko_client: new CoinGeckoClient(coingecko_config),
    tavily_api_key,
    tavily_max_results: Number(env.TAVILY_MAX_RESULTS ?? 5),
  });
}

export * from './coingecko';

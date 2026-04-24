import { ChatAnthropic } from '@langchain/anthropic';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { Logger } from 'pino';

import { createOrchestratorAgent } from '../../agents/orchestrator';
import {
  createSyncPortfolioStateTool,
} from '../../agents/orchestrator/tools';
import { createContextualResearcherSubagent } from '../../agents/researcher';
import { createContextualResearchToolsFromEnv } from '../../agents/researcher/tools';
import {
  createPortfolioManagerSubagent,
  createPortfolioManagerTools,
} from '../../agents/portfolio-manager';
import { BaysePortfolioManagerHttpClient } from '../../agents/portfolio-manager/bayse';
import {
  createExecutorTools,
} from '../../agents/executor';
import { BayseExecutorHttpClient } from '../../agents/executor/bayse';
import { NotFoundError, UpstreamUnavailableError } from '../common/errors';
import type { BayseConnectionStore } from '../bayse/credentials-service';
import type { WorkspaceArtifactStore } from '../workspaces/artifact-store';
import type { WorkspaceStore } from '../workspaces/store';

export interface OrchestratorRuntimeExecuteInput {
  narrative_id: string;
  thread_id: string;
  trigger: 'manual' | 'scheduler' | 'task';
  workspace_id: string;
}

export interface OrchestratorRuntimeExecuteResult {
  files_written: string[];
  summary: string;
}

export interface OrchestratorRuntime {
  execute(
    input: OrchestratorRuntimeExecuteInput,
  ): Promise<OrchestratorRuntimeExecuteResult>;
}

export interface DeepAgentsOrchestratorRuntimeParams {
  anthropic_api_key: string;
  artifact_store: WorkspaceArtifactStore;
  bayse_base_url: string;
  bayse_connection_store: BayseConnectionStore;
  bayse_currency?: string;
  bayse_fallback_public_key?: string;
  bayse_fallback_secret_key?: string;
  bayse_timeout_ms: number;
  executor_model_id: string;
  logger: Logger;
  pm_model_id: string;
  recursion_limit?: number;
  researcher_model_id: string;
  supervisor_model_id: string;
  workspace_store: WorkspaceStore;
}

function extractText(content: BaseMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (
        part &&
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string'
      ) {
        return part.text;
      }
      return '';
    })
    .join('')
    .trim();
}

function makeFileEntry(content: string, now: string) {
  return {
    content,
    mimeType: 'application/json',
    created_at: now,
    modified_at: now,
  };
}

export class DeepAgentsOrchestratorRuntime implements OrchestratorRuntime {
  private readonly artifact_store: WorkspaceArtifactStore;
  private readonly bayse_base_url: string;
  private readonly bayse_connection_store: BayseConnectionStore;
  private readonly bayse_currency: string;
  private readonly bayse_fallback_public_key?: string;
  private readonly bayse_fallback_secret_key?: string;
  private readonly bayse_timeout_ms: number;
  private readonly executor_model: ChatAnthropic;
  private readonly logger: Logger;
  private readonly pm_model: ChatAnthropic;
  private readonly recursion_limit: number;
  private readonly researcher_model: ChatAnthropic;
  private readonly supervisor_model: ChatAnthropic;
  private readonly workspace_store: WorkspaceStore;

  constructor(params: DeepAgentsOrchestratorRuntimeParams) {
    this.artifact_store = params.artifact_store;
    this.bayse_base_url = params.bayse_base_url;
    this.bayse_connection_store = params.bayse_connection_store;
    this.bayse_currency = params.bayse_currency ?? 'USD';
    this.bayse_fallback_public_key = params.bayse_fallback_public_key;
    this.bayse_fallback_secret_key = params.bayse_fallback_secret_key;
    this.bayse_timeout_ms = params.bayse_timeout_ms;
    this.logger = params.logger;
    this.recursion_limit = params.recursion_limit ?? 50;
    this.workspace_store = params.workspace_store;

    const build_model = (model: string) =>
      new ChatAnthropic({
        apiKey: params.anthropic_api_key,
        model,
        temperature: 0.2,
      });

    this.supervisor_model = build_model(params.supervisor_model_id);
    this.researcher_model = build_model(params.researcher_model_id);
    this.pm_model = build_model(params.pm_model_id);
    this.executor_model = build_model(params.executor_model_id);
  }

  async execute(
    input: OrchestratorRuntimeExecuteInput,
  ): Promise<OrchestratorRuntimeExecuteResult> {
    const workspace = await this.workspace_store.getWorkspace(
      input.workspace_id,
    );

    if (!workspace) {
      throw new NotFoundError(
        `Workspace "${input.workspace_id}" was not found.`,
      );
    }

    const [narrative, portfolio, plan, logs] = await Promise.all([
      this.artifact_store.readTextObject(
        workspace.current_narrative_object_key,
      ),
      this.artifact_store.readTextObject(
        workspace.current_portfolio_object_key,
      ),
      this.artifact_store.readTextObject(
        workspace.current_execution_plan_object_key,
      ),
      this.artifact_store.readTextObject(workspace.current_logs_object_key),
    ]);

    const now = new Date().toISOString();
    const initial_files = {
      'narrative.json': makeFileEntry(narrative.content, now),
      'portfolio.json': makeFileEntry(portfolio.content, now),
      'execution_plan.json': makeFileEntry(plan.content, now),
      'logs.json': makeFileEntry(logs.content, now),
    };

    const connection = await this.bayse_connection_store.getConnection(
      workspace.owner_id,
    );
    const user_public_key =
      connection?.latest_api_key?.public_key ??
      this.bayse_fallback_public_key;
    const user_secret_key =
      connection?.latest_api_key?.secret_key ??
      this.bayse_fallback_secret_key;

    if (!user_public_key || !user_secret_key) {
      throw new UpstreamUnavailableError(
        'Orchestrator run cannot place trades: the workspace owner has not connected Bayse or has no API key. Connect the Bayse account and create an API key before running.',
        {
          owner_id: workspace.owner_id,
          has_connection: Boolean(connection),
          has_api_key: Boolean(connection?.latest_api_key),
        },
      );
    }

    const pm_bayse_client = new BaysePortfolioManagerHttpClient({
      base_url: this.bayse_base_url,
      currency: this.bayse_currency,
      public_key: user_public_key,
      timeout_ms: this.bayse_timeout_ms,
    });

    const executor_bayse_client = new BayseExecutorHttpClient({
      base_url: this.bayse_base_url,
      currency: this.bayse_currency,
      public_key: user_public_key,
      secret_key: user_secret_key,
      timeout_ms: this.bayse_timeout_ms,
    });

    const researcher_tool_set = createContextualResearchToolsFromEnv();
    const pm_tool_set = createPortfolioManagerTools(pm_bayse_client);
    const executor_tool_set = createExecutorTools(executor_bayse_client);

    const researcher_subagent = createContextualResearcherSubagent({
      model: this.researcher_model,
      tool_set: researcher_tool_set,
    });
    const pm_subagent = createPortfolioManagerSubagent({
      bayse_client: pm_bayse_client,
      model: this.pm_model,
      tool_set: pm_tool_set,
    });

    const orchestrator_tools = [
      createSyncPortfolioStateTool(pm_bayse_client),
      ...executor_tool_set.tools,
    ];

    const agent = createOrchestratorAgent({
      model: this.supervisor_model,
      subagents: [researcher_subagent, pm_subagent],
      tools: orchestrator_tools,
    });

    let final_state: Record<string, unknown>;
    try {
      final_state = (await agent.invoke(
        {
          files: initial_files,
          messages: [
            new HumanMessage(
              'Run the 4-hour orchestration cycle now. Delegate to the contextual researcher to evaluate outside-world evidence for pending narrative events and update narrative.json. Then delegate to the portfolio manager to produce execution_plan.json from the updated narrative, current portfolio, and live Bayse markets. Then directly use your execution tools to place trades on Bayse, reconcile receipts into portfolio.json, and clear the execution plan. Only perform steps that are justified by the current workspace state — if the narrative is terminal, or if no research is needed, skip to the next step. Summarize what you did at the end.',
            ),
          ],
        },
        {
          configurable: {
            narrativeId: input.narrative_id,
            runReason: input.trigger === 'manual' ? 'manual' : 'cron',
            workspaceId: input.workspace_id,
          },
          recursionLimit: this.recursion_limit,
        },
      )) as Record<string, unknown>;
    } catch (error) {
      this.logger.error(
        {
          err: error,
          thread_id: input.thread_id,
          workspace_id: input.workspace_id,
        },
        'orchestrator deep agent invocation failed',
      );
      throw new UpstreamUnavailableError(
        error instanceof Error
          ? error.message
          : 'Orchestrator runtime failed.',
        {
          runtime: 'deepagents',
          thread_id: input.thread_id,
        },
      );
    }

    const final_files = (final_state.files ?? {}) as Record<
      string,
      { content?: string | Uint8Array }
    >;
    const files_written: string[] = [];

    const writeBack = async (file_key: string, object_key: string) => {
      const entry = final_files[file_key];
      if (!entry || typeof entry.content !== 'string') {
        return;
      }

      await this.artifact_store.writeTextObject({
        content: entry.content,
        content_type: 'application/json',
        object_key,
      });
      files_written.push(file_key);
    };

    await writeBack('narrative.json', workspace.current_narrative_object_key);
    await writeBack(
      'portfolio.json',
      workspace.current_portfolio_object_key,
    );
    await writeBack(
      'execution_plan.json',
      workspace.current_execution_plan_object_key,
    );
    await writeBack('logs.json', workspace.current_logs_object_key);

    const messages = (final_state.messages ?? []) as BaseMessage[];
    const last_ai = [...messages]
      .reverse()
      .find((message) => message.type === 'ai') as AIMessage | undefined;
    const summary = last_ai
      ? extractText(last_ai.content).slice(0, 2000)
      : 'Orchestrator run completed with no summary.';

    return { files_written, summary };
  }
}

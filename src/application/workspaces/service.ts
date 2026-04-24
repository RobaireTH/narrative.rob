import { randomUUID } from 'crypto';
import type { Logger } from 'pino';

import {
  create_empty_execution_plan,
} from '../../domain/execution-plan/schema';
import { create_empty_logs } from '../../domain/logs/schema';
import {
  portfolio_schema,
  type PortfolioJson,
} from '../../domain/portfolio/schema';
import type { NarrativeStore } from '../narratives/store';
import type { WorkspaceArtifactStore } from './artifact-store';
import type {
  WorkspaceRecord,
  WorkspaceStore,
} from './store';
import type { OrchestratorService } from '../orchestrator/service';
import { NotFoundError } from '../common/errors';

export interface WorkspaceBootstrapServiceParams {
  artifact_object_prefix: string;
  artifact_store: WorkspaceArtifactStore;
  logger: Logger;
  narrative_store: NarrativeStore;
  orchestrator_service: Pick<
    OrchestratorService,
    'initializeScheduleForWorkspace'
  >;
  workspace_store: WorkspaceStore;
}

function buildEventLedgers(narrative_event_ids: string[]) {
  return narrative_event_ids.map((event_id) => ({
    event_id,
    free_liquidity: 0,
    realized_pnl: 0,
  }));
}

function buildObjectKey(params: {
  file_name: string;
  prefix: string;
  workspace_id: string;
}) {
  return `${params.prefix.replace(/\/$/, '')}/${params.workspace_id}/current/${params.file_name}`;
}

export class WorkspaceBootstrapService {
  private readonly artifact_object_prefix: string;
  private readonly artifact_store: WorkspaceArtifactStore;
  private readonly logger: Logger;
  private readonly narrative_store: NarrativeStore;
  private readonly orchestrator_service: Pick<
    OrchestratorService,
    'initializeScheduleForWorkspace'
  >;
  private readonly workspace_store: WorkspaceStore;

  constructor(params: WorkspaceBootstrapServiceParams) {
    this.artifact_object_prefix = params.artifact_object_prefix;
    this.artifact_store = params.artifact_store;
    this.logger = params.logger;
    this.narrative_store = params.narrative_store;
    this.orchestrator_service = params.orchestrator_service;
    this.workspace_store = params.workspace_store;
  }

  async bootstrapWorkspace(input: {
    base_currency?: 'USD' | 'NGN';
    initial_master_liquidity?: number;
    narrative_id: string;
    owner_id: string;
    thread_id: string;
  }) {
    const narrative_record = await this.narrative_store.getNarrative(
      input.narrative_id,
    );

    if (!narrative_record) {
      throw new NotFoundError(
        `Narrative "${input.narrative_id}" was not found.`,
      );
    }

    if (narrative_record.owner_id !== input.owner_id) {
      throw new NotFoundError(
        `Narrative "${input.narrative_id}" was not found.`,
      );
    }

    const existing_workspace =
      await this.workspace_store.getWorkspaceByThread(input.thread_id);
    if (
      existing_workspace &&
      existing_workspace.owner_id === input.owner_id &&
      existing_workspace.narrative_id ===
        narrative_record.narrative.narrative_id
    ) {
      this.logger.info(
        {
          narrative_id: input.narrative_id,
          owner_id: input.owner_id,
          thread_id: input.thread_id,
          workspace_id: existing_workspace.workspace_id,
        },
        'workspace bootstrap reused existing workspace',
      );

      const reused_schedule =
        await this.orchestrator_service.initializeScheduleForWorkspace({
          narrative_id: input.narrative_id,
          thread_id: input.thread_id,
          workspace_id: existing_workspace.workspace_id,
        });

      return {
        reused: true as const,
        schedule: reused_schedule,
        workspace: existing_workspace,
      };
    }

    const base_currency = input.base_currency ?? 'USD';
    const workspace_id = randomUUID();
    const portfolio_id = randomUUID();
    const now = new Date().toISOString();

    const portfolio: PortfolioJson = portfolio_schema.parse({
      base_currency,
      event_ledgers: buildEventLedgers(
        narrative_record.narrative.events.map((event) => event.event_id),
      ),
      narrative_id: narrative_record.narrative.narrative_id,
      portfolio_id,
      positions: [],
      unallocated_master_liquidity: input.initial_master_liquidity ?? 0,
    });
    const execution_plan = create_empty_execution_plan({
      generated_at: now,
      narrative_id: narrative_record.narrative.narrative_id,
      portfolio_id,
      summary: 'Initial empty execution plan',
    });
    const logs = create_empty_logs();

    const narrative_object_key = buildObjectKey({
      file_name: 'narrative.json',
      prefix: this.artifact_object_prefix,
      workspace_id,
    });
    const portfolio_object_key = buildObjectKey({
      file_name: 'portfolio.json',
      prefix: this.artifact_object_prefix,
      workspace_id,
    });
    const execution_plan_object_key = buildObjectKey({
      file_name: 'execution_plan.json',
      prefix: this.artifact_object_prefix,
      workspace_id,
    });
    const logs_object_key = buildObjectKey({
      file_name: 'logs.json',
      prefix: this.artifact_object_prefix,
      workspace_id,
    });

    await this.artifact_store.writeTextObject({
      content: JSON.stringify(narrative_record.narrative, null, 2),
      content_type: 'application/json',
      object_key: narrative_object_key,
    });
    await this.artifact_store.writeTextObject({
      content: JSON.stringify(portfolio, null, 2),
      content_type: 'application/json',
      object_key: portfolio_object_key,
    });
    await this.artifact_store.writeTextObject({
      content: JSON.stringify(execution_plan, null, 2),
      content_type: 'application/json',
      object_key: execution_plan_object_key,
    });
    await this.artifact_store.writeTextObject({
      content: JSON.stringify(logs, null, 2),
      content_type: 'application/json',
      object_key: logs_object_key,
    });

    const workspace: WorkspaceRecord = {
      base_currency,
      created_at: now,
      current_execution_plan_object_key: execution_plan_object_key,
      current_logs_object_key: logs_object_key,
      current_narrative_object_key: narrative_object_key,
      current_portfolio_object_key: portfolio_object_key,
      narrative_id: narrative_record.narrative.narrative_id,
      owner_id: input.owner_id,
      portfolio_id,
      thread_id: input.thread_id,
      updated_at: now,
      version: 1,
      workspace_id,
    };

    await this.workspace_store.saveWorkspace(workspace);
    await this.narrative_store.attachWorkspace({
      narrative_id: input.narrative_id,
      workspace_id,
    });
    const schedule =
      await this.orchestrator_service.initializeScheduleForWorkspace({
        narrative_id: input.narrative_id,
        thread_id: input.thread_id,
        workspace_id,
      });

    return {
      reused: false as const,
      schedule,
      workspace,
    };
  }

  async listWorkspaces(owner_id: string) {
    return this.workspace_store.listByOwner(owner_id);
  }

  async getWorkspace(params: {
    owner_id: string;
    workspace_id: string;
  }) {
    const workspace = await this.workspace_store.getWorkspace(
      params.workspace_id,
    );

    if (!workspace) {
      throw new NotFoundError(
        `Workspace "${params.workspace_id}" was not found.`,
      );
    }

    if (workspace.owner_id !== params.owner_id) {
      throw new NotFoundError(
        `Workspace "${params.workspace_id}" was not found.`,
      );
    }

    return workspace;
  }

  async getWorkspaceFile(params: {
    file_name: 'execution_plan' | 'logs' | 'narrative' | 'portfolio';
    owner_id: string;
    workspace_id: string;
  }) {
    const workspace = await this.getWorkspace({
      owner_id: params.owner_id,
      workspace_id: params.workspace_id,
    });

    const object_key =
      params.file_name === 'narrative'
        ? workspace.current_narrative_object_key
        : params.file_name === 'portfolio'
          ? workspace.current_portfolio_object_key
          : params.file_name === 'execution_plan'
            ? workspace.current_execution_plan_object_key
            : workspace.current_logs_object_key;

    return this.artifact_store.readTextObject(object_key);
  }
}

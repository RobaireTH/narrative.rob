import { randomUUID } from 'crypto';
import type { Logger } from 'pino';

import {
  create_empty_logs,
  logs_json_schema,
  type LogsJson,
} from '../../domain/logs/schema';
import {
  portfolio_schema,
  type PortfolioJson,
} from '../../domain/portfolio/schema';
import type { WorkspaceArtifactStore } from '../workspaces/artifact-store';
import type { WorkspaceStore } from '../workspaces/store';
import {
  NotFoundError,
  ValidationAppError,
} from '../common/errors';

const MAX_SINGLE_DEPOSIT_AMOUNT = 1_000_000_000;

export interface PortfolioServiceParams {
  artifact_store: WorkspaceArtifactStore;
  logger: Logger;
  workspace_store: WorkspaceStore;
}

export interface DepositInput {
  amount: number;
  note?: string;
  owner_id: string;
  workspace_id: string;
}

export interface DepositResult {
  log_id: string;
  portfolio: PortfolioJson;
}

export class PortfolioService {
  private readonly artifact_store: WorkspaceArtifactStore;
  private readonly logger: Logger;
  private readonly workspace_store: WorkspaceStore;

  constructor(params: PortfolioServiceParams) {
    this.artifact_store = params.artifact_store;
    this.logger = params.logger;
    this.workspace_store = params.workspace_store;
  }

  async deposit(input: DepositInput): Promise<DepositResult> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new ValidationAppError(
        'Deposit amount must be a positive, finite number.',
        { amount: input.amount },
      );
    }

    if (input.amount > MAX_SINGLE_DEPOSIT_AMOUNT) {
      throw new ValidationAppError(
        `Deposit amount exceeds the per-call ceiling (${MAX_SINGLE_DEPOSIT_AMOUNT}).`,
        { amount: input.amount },
      );
    }

    const workspace = await this.workspace_store.getWorkspace(
      input.workspace_id,
    );

    if (!workspace || workspace.owner_id !== input.owner_id) {
      throw new NotFoundError(
        `Workspace "${input.workspace_id}" was not found.`,
      );
    }

    const portfolio_read = await this.artifact_store.readTextObject(
      workspace.current_portfolio_object_key,
    );
    const portfolio = portfolio_schema.parse(
      JSON.parse(portfolio_read.content),
    );

    const updated_portfolio: PortfolioJson = portfolio_schema.parse({
      ...portfolio,
      unallocated_master_liquidity:
        portfolio.unallocated_master_liquidity + input.amount,
    });

    let logs: LogsJson;
    try {
      const logs_read = await this.artifact_store.readTextObject(
        workspace.current_logs_object_key,
      );
      logs = logs_json_schema.parse(JSON.parse(logs_read.content));
    } catch {
      logs = create_empty_logs();
    }

    const log_id = randomUUID();
    logs.entries.push({
      actor: 'system',
      event: 'PORTFOLIO_DEPOSIT',
      level: 'INFO',
      log_id,
      message: `Deposited ${input.amount} ${portfolio.base_currency} into master liquidity.`,
      metadata: {
        amount: input.amount,
        base_currency: portfolio.base_currency,
        new_balance: updated_portfolio.unallocated_master_liquidity,
        note: input.note,
        owner_id: input.owner_id,
        previous_balance: portfolio.unallocated_master_liquidity,
        workspace_id: input.workspace_id,
      },
      timestamp: new Date().toISOString(),
    });

    await this.artifact_store.writeTextObject({
      content: JSON.stringify(updated_portfolio, null, 2),
      content_type: 'application/json',
      object_key: workspace.current_portfolio_object_key,
    });
    await this.artifact_store.writeTextObject({
      content: JSON.stringify(logs, null, 2),
      content_type: 'application/json',
      object_key: workspace.current_logs_object_key,
    });

    this.logger.info(
      {
        amount: input.amount,
        log_id,
        owner_id: input.owner_id,
        workspace_id: input.workspace_id,
      },
      'portfolio deposit applied',
    );

    return {
      log_id,
      portfolio: updated_portfolio,
    };
  }
}

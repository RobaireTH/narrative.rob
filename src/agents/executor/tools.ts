import { randomUUID } from 'crypto';

import { ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import {
  StateBackend,
  resolveBackend,
  type AnyBackendProtocol,
  type BackendFactory,
} from 'deepagents';
import { tool, type StructuredTool, type ToolRuntime } from 'langchain';
import { z } from 'zod';

import { create_empty_execution_plan, execution_plan_schema } from '../../domain/execution-plan/schema';
import { portfolio_schema, type PortfolioJson, type PortfolioPosition } from '../../domain/portfolio/schema';
import {
  bayse_execute_trade_schema,
  commit_portfolio_update_schema,
  type CommitPortfolioReceipt
} from './schema';
import {
  BayseExecutorHttpClient,
  resolveBayseExecutorClientConfig,
  type ExecutorTradeReceipt,
} from './bayse';

/**
 * Write-capable exchange contract for the Executor.
 */
export interface BayseExecutorClient {
  executeTrade(input: {
    action: 'BUY' | 'SELL' | 'REDUCE' | 'LIQUIDATE';
    bayse_event_id: string;
    market_id: string;
    order_id: string;
    outcome_id: string;
    outcome_label: 'YES' | 'NO';
    share_quantity: number;
    side: 'YES' | 'NO';
    worst_acceptable_price?: number;
  }): Promise<ExecutorTradeReceipt>;
}

// Schemas successfully extracted to schema.ts

function derive_position_match(
  portfolio: PortfolioJson,
  order: z.infer<typeof execution_plan_schema>['orders'][number],
) {
  return portfolio.positions.findIndex(
    (position) =>
      position.status === 'OPEN' &&
      position.bayse_event_id === order.bayse_event_id &&
      position.market_id === order.market_id &&
      position.event_id === order.event_id &&
      position.side === order.side &&
      position.outcome_id === order.outcome_id &&
      position.outcome_label === order.outcome_label,
  );
}

function derive_fidelity_tag(
  order: z.infer<typeof execution_plan_schema>['orders'][number],
): PortfolioPosition['fidelity_tag'] {
  if (order.fidelity_tag) {
    return order.fidelity_tag;
  }

  return order.correlation_tier === 'EXACT' ? 'EXACT' : 'PROXY';
}

export function reconcile_receipt_into_portfolio(params: {
  now: string;
  order: z.infer<typeof execution_plan_schema>['orders'][number];
  portfolio: PortfolioJson;
  receipt: CommitPortfolioReceipt;
}) {
  const position_index = derive_position_match(params.portfolio, params.order);

  if (!params.receipt.success) {
    return;
  }

  if (params.receipt.action === 'BUY') {
    if (
      typeof params.receipt.actual_usdc_spent !== 'number' ||
      typeof params.receipt.shares_acquired !== 'number' ||
      !params.order.side
    ) {
      throw new Error(
        `BUY receipt for order ${params.receipt.order_id} is missing required accounting fields.`,
      );
    }

    const ledger = params.portfolio.event_ledgers.find((l) => l.event_id === params.order.event_id);
    if (!ledger) {
      throw new Error(`Event ledger for event ${params.order.event_id} not found.`);
    }

    ledger.free_liquidity = Math.max(
      0,
      ledger.free_liquidity - params.receipt.actual_usdc_spent,
    );

    if (position_index >= 0) {
      const existing = params.portfolio.positions[position_index];
      const existing_cost = existing.entry_price * existing.share_quantity;
      const new_cost = params.receipt.actual_usdc_spent;
      const total_shares = existing.share_quantity + params.receipt.shares_acquired;

      params.portfolio.positions[position_index] = {
        ...existing,
        entry_price: (existing_cost + new_cost) / total_shares,
        share_quantity: total_shares,
      };
      return;
    }

    params.portfolio.positions.push({
      entry_price:
        params.receipt.actual_usdc_spent / params.receipt.shares_acquired,
      bayse_event_id: params.order.bayse_event_id,
      expression_score: params.order.expression_score,
      fidelity_tag: derive_fidelity_tag(params.order),
      event_id: params.order.event_id,
      market_id: params.order.market_id,
      opened_at: params.now,
      outcome_id: params.order.outcome_id,
      outcome_label: params.order.outcome_label,
      position_id: randomUUID(),
      share_quantity: params.receipt.shares_acquired,
      side: params.order.side,
      status: 'OPEN',
    });
    return;
  }

  if (
    typeof params.receipt.actual_usdc_received !== 'number' ||
    typeof params.receipt.shares_sold !== 'number'
  ) {
    throw new Error(
      `${params.receipt.action} receipt for order ${params.receipt.order_id} is missing required accounting fields.`,
    );
  }

  if (position_index < 0) {
    throw new Error(
      `Could not find an existing position for order ${params.receipt.order_id}.`,
    );
  }

  const existing = params.portfolio.positions[position_index];
  const new_share_quantity = existing.share_quantity - params.receipt.shares_sold;
  const realized_delta =
    params.receipt.actual_usdc_received -
    existing.entry_price * params.receipt.shares_sold;

  const ledger = params.portfolio.event_ledgers.find((l) => l.event_id === params.order.event_id);
  if (!ledger) {
    throw new Error(`Event ledger for event ${params.order.event_id} not found.`);
  }
  ledger.free_liquidity += params.receipt.actual_usdc_received;
  ledger.realized_pnl += realized_delta;

  if (new_share_quantity <= 0) {
    params.portfolio.positions[position_index] = {
      ...existing,
      closed_at: params.now,
      status: 'CLOSED_SOLD',
    };
    return;
  }

  params.portfolio.positions[position_index] = {
    ...existing,
    share_quantity: new_share_quantity,
    status: 'OPEN',
  };
}

/**
 * Create the Bayse trade execution tool.
 */
export function createBayseExecuteTradeTool(
  client: BayseExecutorClient,
): StructuredTool {
  return tool(
    async (input) => {
      const parsed = bayse_execute_trade_schema.parse(input);
      return JSON.stringify(await client.executeTrade(parsed), null, 2);
    },
    {
      description:
        'Execute one trade on Bayse and return a normalized execution receipt. Use this for BUY, SELL, REDUCE, or LIQUIDATE actions from the execution plan.',
      name: 'bayse_execute_trade',
      schema: bayse_execute_trade_schema,
    },
  );
}

/**
 * Create the atomic portfolio commit tool.
 *
 * The tool reads the current portfolio and execution plan, applies the provided
 * receipts as deterministic deltas, preserves untouched positions, and then
 * writes `portfolio.json` directly.
 */
export function createCommitPortfolioUpdateTool(
  backend: AnyBackendProtocol | BackendFactory = new StateBackend(),
): StructuredTool {
  return tool(
    async (input, runtime: ToolRuntime) => {
      const parsed = commit_portfolio_update_schema.parse(input);
      const now = new Date().toISOString();
      const resolvedBackend = await resolveBackend(backend, runtime);
      const portfolio_read_result = await resolvedBackend.read('portfolio.json');
      if (portfolio_read_result.error) {
        return portfolio_read_result.error;
      }

      const execution_plan_read_result = await resolvedBackend.read('execution_plan.json');
      if (execution_plan_read_result.error) {
        return execution_plan_read_result.error;
      }

      if (typeof portfolio_read_result.content !== 'string') {
        return 'portfolio.json is missing or not readable as text.';
      }

      if (typeof execution_plan_read_result.content !== 'string') {
        return 'execution_plan.json is missing or not readable as text.';
      }

      const portfolio = portfolio_schema.parse(JSON.parse(portfolio_read_result.content));
      const execution_plan = execution_plan_schema.parse(
        JSON.parse(execution_plan_read_result.content),
      );

      if (
        portfolio.portfolio_id !== parsed.portfolio_id ||
        portfolio.narrative_id !== parsed.narrative_id
      ) {
        return 'Portfolio identity mismatch while reconciling execution receipts.';
      }

      const order_lookup = new Map(
        execution_plan.orders.map((order) => [order.order_id, order]),
      );
      const failed_reconciliations: string[] = [];

      for (const receipt of parsed.receipts) {
        const order = order_lookup.get(receipt.order_id);
        if (!order) {
          failed_reconciliations.push(
            `Unknown order_id "${receipt.order_id}" in portfolio reconciliation.`,
          );
          continue;
        }

        try {
          reconcile_receipt_into_portfolio({
            now,
            order,
            portfolio,
            receipt,
          });
        } catch (error) {
          failed_reconciliations.push(
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      const validated_portfolio = portfolio_schema.parse(portfolio);

      const result = await resolvedBackend.write(
        'portfolio.json',
        JSON.stringify(validated_portfolio, null, 2),
      );

      if (result.error) {
        return result.error;
      }

      let content =
        'SUCCESS: portfolio.json has been validated and written to the workspace.';
      if (failed_reconciliations.length > 0) {
        content += ` WARNING: Some receipts failed to reconcile: ${failed_reconciliations.join(' | ')}`;
      }

      const message = new ToolMessage({
        content,
        metadata: result.metadata,
        name: 'commit_portfolio_update',
        tool_call_id: runtime.toolCallId,
      });

      if (result.filesUpdate) {
        return new Command({
          update: {
            files: result.filesUpdate,
            messages: [message],
          },
        });
      }

      return message;
    },
    {
      description:
        'Validate execution receipts, merge them into the current portfolio ledger deterministically, preserve untouched positions, and atomically write portfolio.json.',
      name: 'commit_portfolio_update',
      schema: commit_portfolio_update_schema,
    },
  );
}

/**
 * Create the atomic execution-plan clearing tool.
 *
 * It reads the current plan, preserves narrative/portfolio identifiers, and
 * writes back an empty order array so orders cannot be double-executed.
 */
export function createClearExecutionPlanTool(
  backend: AnyBackendProtocol | BackendFactory = new StateBackend(),
): StructuredTool {
  return tool(
    async (_input, runtime: ToolRuntime) => {
      const resolvedBackend = await resolveBackend(backend, runtime);
      const readResult = await resolvedBackend.read('execution_plan.json');

      if (readResult.error) {
        return readResult.error;
      }

      if (typeof readResult.content !== 'string') {
        return 'execution_plan.json is missing or not readable as text.';
      }

      const current_plan = execution_plan_schema.parse(JSON.parse(readResult.content));
      const cleared_plan = create_empty_execution_plan({
        generated_at: new Date().toISOString(),
        narrative_id: current_plan.narrative_id,
        portfolio_id: current_plan.portfolio_id,
        summary: 'Cleared by executor after execution cycle.',
      });

      const result = await resolvedBackend.write(
        'execution_plan.json',
        JSON.stringify(cleared_plan, null, 2),
      );

      if (result.error) {
        return result.error;
      }

      const message = new ToolMessage({
        content:
          'SUCCESS: execution_plan.json has been cleared for the next orchestration cycle.',
        metadata: result.metadata,
        name: 'clear_execution_plan',
        tool_call_id: runtime.toolCallId,
      });

      if (result.filesUpdate) {
        return new Command({
          update: {
            files: result.filesUpdate,
            messages: [message],
          },
        });
      }

      return message;
    },
    {
      description:
        'Clear execution_plan.json atomically after an execution cycle so the same orders are not executed twice.',
      name: 'clear_execution_plan',
      schema: z.object({}),
    },
  );
}

/**
 * Combined toolset returned to the Executor agent.
 */
export interface ExecutorToolSet {
  bayse_execute_trade: StructuredTool;
  clear_execution_plan: StructuredTool;
  commit_portfolio_update: StructuredTool;
  tools: StructuredTool[];
}

/**
 * Create the full Executor toolset.
 */
export function createExecutorTools(
  client: BayseExecutorClient,
  backend: AnyBackendProtocol | BackendFactory = new StateBackend(),
): ExecutorToolSet {
  const bayse_execute_trade = createBayseExecuteTradeTool(client);
  const commit_portfolio_update = createCommitPortfolioUpdateTool(backend);
  const clear_execution_plan = createClearExecutionPlanTool(backend);

  return {
    bayse_execute_trade,
    clear_execution_plan,
    commit_portfolio_update,
    tools: [
      bayse_execute_trade,
      commit_portfolio_update,
      clear_execution_plan,
    ],
  };
}

/**
 * Create the default Executor toolset from environment variables.
 */
export function createExecutorToolsFromEnv(
  backend: AnyBackendProtocol | BackendFactory = new StateBackend(),
  env: NodeJS.ProcessEnv = process.env,
): ExecutorToolSet {
  const config = resolveBayseExecutorClientConfig(env);
  return createExecutorTools(new BayseExecutorHttpClient(config), backend);
}

export * from './bayse';

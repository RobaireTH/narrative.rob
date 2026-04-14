import { z } from 'zod';
import { tool, type StructuredTool, type ToolRuntime } from 'langchain';
import { ToolMessage } from '@langchain/core/messages';
import { StateBackend, resolveBackend, type AnyBackendProtocol, type BackendFactory } from 'deepagents';

import { execution_plan_schema, create_empty_execution_plan } from '../../domain/execution-plan/schema';
import { portfolio_schema } from '../../domain/portfolio/schema';
import { type BayseExecutorClient, reconcile_receipt_into_portfolio } from './tools';

/**
 * Deterministic engine replacing the LLM. 
 * Reads the execution plan, strictly loops through all orders recursively hitting Bayse, 
 * commits real PnL to the PortfolioLedger, and clears the plan.
 */
export async function executePortfolioPlan(
  client: BayseExecutorClient,
  backend: AnyBackendProtocol
) {
  const portfolio_read: any = await backend.read('portfolio.json');
  if (portfolio_read.error) throw new Error(portfolio_read.error);

  const plan_read: any = await backend.read('execution_plan.json');
  if (plan_read.error) throw new Error(plan_read.error);

  const portfolio = portfolio_schema.parse(JSON.parse(portfolio_read.content as string));
  const plan = execution_plan_schema.parse(JSON.parse(plan_read.content as string));

  if (plan.orders.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  for (const order of plan.orders) {
    let receipt;
    try {
      receipt = await client.executeTrade({
        action: order.action,
        bayse_event_id: order.bayse_event_id,
        market_id: order.market_id,
        order_id: order.order_id as string,
        outcome_id: order.outcome_id,
        outcome_label: order.outcome_label,
        share_quantity: order.share_quantity,
        side: order.side,
        worst_acceptable_price: order.worst_acceptable_price,
      });
    } catch (e) {
      receipt = {
        action: order.action,
        order_id: order.order_id as string,
        success: false,
        error: e instanceof Error ? e.message : String(e)
      };
    }

    reconcile_receipt_into_portfolio({
      now,
      order,
      portfolio,
      // @ts-ignore - Ignore exact struct shape variance from fallback errors
      receipt
    });
  }

  const validated_portfolio = portfolio_schema.parse(portfolio);
  const write_portfolio: any = await backend.write('portfolio.json', JSON.stringify(validated_portfolio, null, 2));

  if (write_portfolio.error) throw new Error(write_portfolio.error);

  const cleared_plan = create_empty_execution_plan({
    generated_at: now,
    narrative_id: plan.narrative_id,
    portfolio_id: plan.portfolio_id,
    summary: 'Cleared by deterministic executor after execution array completed.'
  });

  const write_plan: any = await backend.write('execution_plan.json', JSON.stringify(cleared_plan, null, 2));
  if (write_plan.error) throw new Error(write_plan.error);
}

/**
 * Creates the LangChain tool wrapper so the Orchestrator can call this engine deterministically.
 */
export function createExecutePortfolioPlanTool(
  client: BayseExecutorClient,
  backend: AnyBackendProtocol | BackendFactory = new StateBackend()
): StructuredTool {
  return tool(
    async (_input, runtime: ToolRuntime) => {
      const resolvedBackend = await resolveBackend(backend, runtime);
      try {
        await executePortfolioPlan(client, resolvedBackend);

        return new ToolMessage({
          content: "SUCCESS: execution_plan.json orders have been routed to the exchange, portfolio.json is updated, and the plan is cleared.",
          name: "execute_portfolio_plan",
          tool_call_id: runtime.toolCallId,
        });

      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    {
      name: "execute_portfolio_plan",
      description: "Read execution_plan.json, route all orders to the exchange deterministically, update portfolio.json with the new balances, and clear the execution plan file. Use this for Step 4 of your sequence.",
      schema: z.object({})
    }
  );
}

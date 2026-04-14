import { randomUUID } from "crypto";
import { ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import {
  StateBackend,
  resolveBackend,
  type BackendFactory,
  type AnyBackendProtocol,
} from "deepagents";
import { tool, type StructuredTool, type ToolRuntime } from "langchain";
import { z } from "zod";

import {
  portfolio_schema,
  type PortfolioJson,
} from "../../domain/portfolio/schema";
import {
  execution_plan_schema,
  create_empty_execution_plan,
} from "../../domain/execution-plan/schema";
import {
  BaysePortfolioManagerHttpClient,
  resolveBaysePortfolioManagerClientConfig,
} from "./bayse";
import {
  bayse_search_markets_schema,
  bayse_get_market_orderbook_schema,
  bayse_get_trade_quote_schema,
  bayse_calculate_event_nav_schema,
  llm_commit_execution_plan_schema,
} from "./schema";

export interface PortfolioManagerBayseSearchMarket {
  feePercentage: number;
  id: string;
  noBuyPrice: number;
  outcome1Id?: string;
  outcome1Label?: string;
  outcome1Price?: number;
  outcome2Id?: string;
  outcome2Label?: string;
  outcome2Price?: number;
  rules: string;
  status?: string;
  title: string;
  totalOrder: number;
  yesBuyPrice: number;
}

export interface PortfolioManagerBayseSearchEvent {
  closingDate?: string;
  description: string;
  engine: string;
  id: string;
  liquidity: number;
  markets: PortfolioManagerBayseSearchMarket[];
  resolutionDate: string;
  status: string;
  supportedCurrencies: Array<"USD" | "NGN">;
  title: string;
  totalOrders: number;
  totalVolume: number;
  type: string;
  userWatchlisted: boolean;
}

/**
 * Current liquidation estimate for an open position in the configured Bayse currency.
 */
export interface PortfolioManagerPositionValuation {
  currency?: string;
  estimated_value: number;
  mark_price?: number;
  outcome_id: string;
}

/**
 * Fresh Bayse quote used by the PM to convert a planned cash amount into
 * executable shares and a current reference price.
 */
export interface PortfolioManagerTradeQuote {
  amount?: number;
  completeFill?: boolean;
  costOfShares?: number;
  currency?: string;
  currencyBaseMultiplier?: number;
  currentMarketPrice?: number;
  fee?: number;
  market_id: string;
  outcome_id: string;
  outcome_label: "YES" | "NO";
  price?: number;
  priceImpactAbsolute?: number;
  profitPercentage?: number;
  quantity?: number;
  side: "BUY" | "SELL";
  tradeGoesOverMaxLiability?: boolean;
}

/**
 * Exchange-side state snapshot for one Bayse market.
 *
 * The PM uses this to decide whether local positions are still tradable,
 * awaiting resolution, or potentially ready for settlement accounting.
 */
export interface PortfolioManagerBayseMarketState {
  is_resolved: boolean;
  is_tradable: boolean;
  market_id: string;
  outcome1_id?: string;
  outcome1_label?: string;
  outcome1_price?: number;
  outcome2_id?: string;
  outcome2_label?: string;
  outcome2_price?: number;
  status?: string;
}

/**
 * Read-only market-data contract for the Portfolio Manager.
 *
 * The PM is exchange-aware, but it never places trades. It only discovers
 * candidate markets, reads liquidity, and estimates current position value.
 */
export interface BaysePortfolioManagerClient {
  estimatePositionValue(input: {
    bayse_event_id: string;
    market_id: string;
    outcome_id: string;
    share_quantity: number;
  }): Promise<PortfolioManagerPositionValuation>;
  getTradeQuote(input: {
    amount: number;
    bayse_event_id: string;
    market_id: string;
    outcome_id: string;
    outcome_label: "YES" | "NO";
    side: "BUY" | "SELL";
  }): Promise<PortfolioManagerTradeQuote>;
  getMarketState(input: {
    bayse_event_id: string;
    market_id: string;
  }): Promise<PortfolioManagerBayseMarketState>;
  getMarketOrderbook(input: { outcome_id: string }): Promise<{
    available_liquidity?: number;
    best_ask_price?: number;
    best_bid_price?: number;
    currency?: string;
    outcome_id: string;
  }>;
  searchMarkets(input: {
    keyword: string;
    limit?: number;
  }): Promise<PortfolioManagerBayseSearchEvent[]>;
}

// Schemas isolated in schema.ts

/**
 * Create the Bayse market-discovery tool used by the Portfolio Manager.
 */
export function createBayseSearchMarketsTool(
  client: Pick<BaysePortfolioManagerClient, "searchMarkets">,
): StructuredTool {
  return tool(
    async (input) => {
      const parsed = bayse_search_markets_schema.parse(input);
      return JSON.stringify(await client.searchMarkets(parsed), null, 2);
    },
    {
      description:
        "Search Bayse for active prediction-market events using Bayse server-side keyword filtering. This is a discovery tool, not a classifier. It returns raw Bayse event objects with nested market data. After calling it, inspect the nested markets inside each returned event and decide which specific markets are usable candidates for EXACT, STRONG_PROXY, or STANDARD_PROXY expression.",
      name: "bayse_search_markets",
      schema: bayse_search_markets_schema,
    },
  );
}

/**
 * Create the Bayse trade-quote tool used by the Portfolio Manager.
 */
export function createBayseGetTradeQuoteTool(
  client: Pick<BaysePortfolioManagerClient, "getTradeQuote">,
): StructuredTool {
  return tool(
    async (input) => {
      const parsed = bayse_get_trade_quote_schema.parse(input);
      return JSON.stringify(await client.getTradeQuote(parsed), null, 2);
    },
    {
      description:
        "Get a fresh Bayse trade quote for one market using the documented amount-based quote API. Use this whenever the PM needs current executable price, quantity, fee, or price-impact information for a planned trade. Requires the Bayse parent event id and the market id. For Bayse side BUY, amount means the cash you are willing to spend. For Bayse side SELL, amount means the cash you want to receive back. The returned quantity is the share count implied by that amount at current market conditions and can be used to set the final order share_quantity.",
      name: "bayse_get_trade_quote",
      schema: bayse_get_trade_quote_schema,
    },
  );
}

/**
 * Create the Bayse orderbook inspection tool used by the Portfolio Manager.
 */
export function createBayseGetMarketOrderbookTool(
  client: Pick<BaysePortfolioManagerClient, "getMarketOrderbook">,
): StructuredTool {
  return tool(
    async (input) => {
      const parsed = bayse_get_market_orderbook_schema.parse(input);
      return JSON.stringify(await client.getMarketOrderbook(parsed), null, 2);
    },
    {
      description:
        "Inspect Bayse orderbook and shallow executable liquidity for one specific outcome. This is a read-only market-quality tool, not a valuation tool. It returns bids, asks, and a shallow currency-denominated liquidity summary for the requested outcome. Use it after market discovery when deciding whether an outcome can absorb planned size without unacceptable execution quality.",
      name: "bayse_get_market_orderbook",
      schema: bayse_get_market_orderbook_schema,
    },
  );
}

/**
 * Create the live sub-portfolio valuation tool used by the Portfolio Manager.
 */
export function createBayseCalculateEventNavTool(
  client: Pick<BaysePortfolioManagerClient, "estimatePositionValue">,
): StructuredTool {
  return tool(
    async (input) => {
      const parsed = bayse_calculate_event_nav_schema.parse(input);
      let total_position_value = 0;

      for (const pos of parsed.positions) {
        try {
          const val = await client.estimatePositionValue({
            bayse_event_id: pos.bayse_event_id,
            market_id: pos.market_id,
            outcome_id: pos.outcome_id,
            share_quantity: pos.share_quantity,
          });
          total_position_value += val.estimated_value;
        } catch (e) {
          console.error(`Valuation failed for position ${pos.market_id}:`, e);
          // We continue with other positions to get a partial but best-effort NAV
        }
      }

      const event_nav = parsed.free_liquidity + total_position_value;

      return JSON.stringify(
        {
          event_id: parsed.event_id,
          free_liquidity: parsed.free_liquidity,
          positions_value: total_position_value,
          event_nav: event_nav,
        },
        null,
        2,
      );
    },
    {
      description:
        "Calculate the total Net Asset Value (NAV) for the current event's localized sub-portfolio. This tool fetches live 'Mark-to-Market' valuations for all provided open positions and adds them to the available free_liquidity. The resulting 'event_nav' must be used as the capital base for all fidelity-score sizing math (Target = NAV * Score^2).",
      name: "bayse_calculate_event_nav",
      schema: bayse_calculate_event_nav_schema,
    },
  );
}

/**
 * Combined toolset returned to the Portfolio Manager agent.
 */
export interface PortfolioManagerToolSet {
  commit_execution_plan: StructuredTool;
  tools: StructuredTool[];
}



/**
 * Create the schema-validated execution-plan commit tool.
 *
 * The PM should use this as the final boundary before writing
 * `execution_plan.json`.
 */
export function createCommitExecutionPlanTool(
  backend: AnyBackendProtocol | BackendFactory = new StateBackend(),
): StructuredTool {
  return tool(
    async (input, runtime: ToolRuntime) => {
      const parsed = llm_commit_execution_plan_schema.parse(input);
      const resolved_backend = await resolveBackend(backend, runtime);
      const now = new Date().toISOString();

      // 1. Read existing plan or create empty
      const existing_read: any = await resolved_backend.read("execution_plan.json");
      let plan;
      if (existing_read.error || !existing_read.content) {
        plan = create_empty_execution_plan({
          generated_at: now,
          narrative_id: parsed.narrative_id,
          portfolio_id: parsed.portfolio_id,
          summary: parsed.summary,
        });
      } else {
        try {
          plan = execution_plan_schema.parse(JSON.parse(existing_read.content));
        } catch (e) {
          plan = create_empty_execution_plan({
            generated_at: now,
            narrative_id: parsed.narrative_id,
            portfolio_id: parsed.portfolio_id,
            summary: parsed.summary,
          });
        }
      }

      // 2. Map and Sort new orders locally (Priority: LIQUIDATE > SELL > REDUCE > BUY)
      const getActionPriority = (action: string) => {
        if (action === "LIQUIDATE") return 0;
        if (action === "SELL") return 1;
        if (action === "REDUCE") return 2;
        if (action === "BUY") return 3;
        return 4;
      };

      const new_batch = parsed.orders
        .map((order) => ({
          order_id: randomUUID(),
          ...order,
        }))
        .sort((a, b) => getActionPriority(a.action) - getActionPriority(b.action));

      // 3. Combine and Update Metadata
      plan.orders = [...plan.orders, ...new_batch];
      plan.generated_at = now;
      if (parsed.summary) {
        plan.summary = plan.summary ? `${plan.summary} | ${parsed.summary}` : parsed.summary;
      }

      const result = await resolved_backend.write(
        "execution_plan.json",
        JSON.stringify(plan, null, 2),
      );

      if (result.error) {
        return result.error;
      }

      const message = new ToolMessage({
        content:
          `SUCCESS: execution_plan.json has been updated. Added ${new_batch.length} orders. Total orders: ${plan.orders.length}. Orders within this batch are sorted deterministically (Sells/Liquidations first).`,
        tool_call_id: runtime.toolCallId,
        name: "commit_execution_plan",
        metadata: result.metadata,
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
        "Validate the complete final execution plan against the runtime schema and write it directly to execution_plan.json in one atomic step. This is the PM's final write boundary. Use it only after the plan is complete and do not hand-write execution_plan.json yourself.",
      name: "commit_execution_plan",
      schema: llm_commit_execution_plan_schema,
    },
  );
}

/**
 * Create the full read-only Bayse toolset for the Portfolio Manager.
 */
export function createPortfolioManagerTools(
  client: BaysePortfolioManagerClient,
  backend: AnyBackendProtocol | BackendFactory = new StateBackend(),
): PortfolioManagerToolSet {
  const commit_execution_plan = createCommitExecutionPlanTool(backend);

  return {
    commit_execution_plan,
    tools: [
      createBayseSearchMarketsTool(client),
      createBayseGetTradeQuoteTool(client),
      createBayseGetMarketOrderbookTool(client),
      createBayseCalculateEventNavTool(client),
      commit_execution_plan,
    ],
  };
}

/**
 * Create the default Portfolio Manager toolset from environment variables.
 */
export function createPortfolioManagerToolsFromEnv(
  backend: AnyBackendProtocol | BackendFactory = new StateBackend(),
  env: NodeJS.ProcessEnv = process.env,
): PortfolioManagerToolSet {
  const config = resolveBaysePortfolioManagerClientConfig(env);
  return createPortfolioManagerTools(
    new BaysePortfolioManagerHttpClient(config),
    backend,
  );
}

export * from "./bayse";

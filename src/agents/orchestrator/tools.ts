import { ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import {
  StateBackend,
  resolveBackend,
  type BackendFactory,
  type AnyBackendProtocol,
} from "deepagents";
import { tool, type StructuredTool, type ToolRuntime } from "langchain";

import {
  portfolio_schema,
  type PortfolioJson,
} from "../../domain/portfolio/schema";
import { sync_portfolio_state_schema } from "./schema";
import {
  type BaysePortfolioManagerClient,
  type PortfolioManagerBayseMarketState
} from "../portfolio-manager/tools";

function getCurrencyBaseMultiplier(currency: PortfolioJson["base_currency"]) {
  return currency === "NGN" ? 100 : 1;
}

function classifyMarketLifecycle(status?: string) {
  const normalized = status?.toLowerCase();

  if (normalized === "open") return "TRADABLE" as const;
  if (normalized === "resolved") return "RESOLVED" as const;
  if (
    normalized === "closed" ||
    normalized === "paused" ||
    normalized === "draft" ||
    normalized === "cancelled"
  ) return "NON_TRADABLE" as const;

  return "UNKNOWN" as const;
}

function isWinningOutcomeId(params: {
  market_state: PortfolioManagerBayseMarketState;
  outcome_id: string;
}): boolean {
  const outcome1_is_winner = params.market_state.outcome1_price === 1;
  const outcome2_is_winner = params.market_state.outcome2_price === 1;

  return (
    (outcome1_is_winner && params.outcome_id === params.market_state.outcome1_id) ||
    (outcome2_is_winner && params.outcome_id === params.market_state.outcome2_id)
  );
}

function isWinningOutcomeLabel(params: {
  market_state: PortfolioManagerBayseMarketState;
  outcome_label: string;
}): boolean {
  const outcome1_is_winner = params.market_state.outcome1_price === 1;
  const outcome2_is_winner = params.market_state.outcome2_price === 1;

  return (
    (outcome1_is_winner && params.market_state.outcome1_label === params.outcome_label) ||
    (outcome2_is_winner && params.market_state.outcome2_label === params.outcome_label)
  );
}

function resolveSettlementValue(params: {
  base_currency: PortfolioJson["base_currency"];
  market_state: PortfolioManagerBayseMarketState;
  outcome_id: string;
  outcome_label: "YES" | "NO";
  share_quantity: number;
}) {
  const multiplier = getCurrencyBaseMultiplier(params.base_currency);
  const is_win =
    isWinningOutcomeId({ market_state: params.market_state, outcome_id: params.outcome_id }) ||
    isWinningOutcomeLabel({ market_state: params.market_state, outcome_label: params.outcome_label });

  return {
    is_win,
    settlement_value: is_win ? params.share_quantity * multiplier : 0,
  };
}

export function createSyncPortfolioStateTool(
  client: Pick<BaysePortfolioManagerClient, "getMarketState">,
  backend: AnyBackendProtocol | BackendFactory = new StateBackend(),
): StructuredTool {
  return tool(
    async (_input, runtime: ToolRuntime) => {
      const resolved_backend = await resolveBackend(backend, runtime);
      const portfolio_read = await resolved_backend.read("portfolio.json");

      if (portfolio_read.error) return portfolio_read.error;
      if (typeof portfolio_read.content !== "string") return "portfolio.json is missing or not readable as text.";

      const portfolio = portfolio_schema.parse(JSON.parse(portfolio_read.content));
      const now = new Date().toISOString();


      for (const position of portfolio.positions) {
        if (
          position.status === "CLOSED_SOLD" ||
          position.status === "SETTLED_WIN" ||
          position.status === "SETTLED_LOSS"
        ) continue;

        const market_state = await client.getMarketState({
          bayse_event_id: position.bayse_event_id,
          market_id: position.market_id,
        });
        const lifecycle = classifyMarketLifecycle(market_state.status);

        if (lifecycle === "RESOLVED" || market_state.is_resolved) {
          const { is_win, settlement_value } = resolveSettlementValue({
            base_currency: portfolio.base_currency,
            market_state,
            outcome_id: position.outcome_id,
            outcome_label: position.outcome_label,
            share_quantity: position.share_quantity,
          });

          const ledger = portfolio.event_ledgers.find((l) => l.event_id === position.event_id);
          if (ledger) {
            ledger.free_liquidity += settlement_value;
            ledger.realized_pnl += settlement_value - position.entry_price * position.share_quantity;
          }
          position.status = is_win ? "SETTLED_WIN" : "SETTLED_LOSS";
          position.closed_at = now;
          continue;
        }

        if (lifecycle === "NON_TRADABLE" || !market_state.is_tradable) {
          position.status = "AWAITING_RESOLUTION";
        }
      }

      const validated_portfolio = portfolio_schema.parse(portfolio);
      const write_result = await resolved_backend.write("portfolio.json", JSON.stringify(validated_portfolio, null, 2));

      if (write_result.error) return write_result.error;

      const message = new ToolMessage({
        content: `SUCCESS: portfolio.json has been synchronized. All resolved markets have been settled into their respective Event_NAV ledgers.`,
        metadata: {},
        name: "sync_portfolio_state",
        tool_call_id: runtime.toolCallId,
      });

      if (write_result.filesUpdate) {
        return new Command({
          update: { files: write_result.filesUpdate, messages: [message] },
        });
      }

      return message;
    },
    {
      description: "Synchronize all non-terminal portfolio positions, settle resolved markets into their corresponding event ledgers dynamically, and overwrite portfolio.json. This is a global Orchestrator tool. Call this exactly once before iterating through individual events so that all PMs receive up-to-date Nav slices.",
      name: "sync_portfolio_state",
      schema: sync_portfolio_state_schema,
    },
  );
}

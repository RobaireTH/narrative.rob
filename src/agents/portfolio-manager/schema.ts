import { z } from 'zod';

export const bayse_search_markets_schema = z.object({
  keyword: z
    .string()
    .min(1)
    .describe(
      'Short identifier keyword to search for on Bayse (e.g. "BTC", "SEC", "Iran", "US"). Do NOT use full sentences or long phrases.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Maximum number of Bayse events to return from the server-side keyword search.',
    ),
});

export const bayse_get_market_orderbook_schema = z.object({
  outcome_id: z
    .string()
    .min(1)
    .describe(
      'Bayse outcome identifier for the side of the market whose orderbook should be inspected.',
    ),
});

export const bayse_get_trade_quote_schema = z.object({
  amount: z
    .number()
    .positive()
    .describe(
      'Cash amount to quote. Bayse quotes are amount-based. For Bayse side BUY this is the cash amount to spend. For Bayse side SELL this is the cash amount you want to receive back.',
    ),
  bayse_event_id: z
    .string()
    .min(1)
    .describe('Bayse parent event identifier required by the quote endpoint.'),
  market_id: z.string().min(1).describe('Bayse market identifier to quote.'),
  outcome_id: z
    .string()
    .min(1)
    .describe('Bayse outcome identifier inside the market.'),
  outcome_label: z
    .enum(['YES', 'NO'])
    .describe('Bayse outcome label for the side being quoted.'),
  side: z
    .enum(['BUY', 'SELL'])
    .describe(
      'Bayse quote direction. Use BUY when planning a BUY. Use SELL when planning a SELL, REDUCE, or LIQUIDATE.',
    ),
});

export const bayse_calculate_event_nav_schema = z.object({
  event_id: z
    .string()
    .min(1)
    .describe('Internal narrative event identifier to calculate NAV for.'),
  free_liquidity: z
    .number()
    .min(0)
    .describe(
      'Current cash available in the event ledger (provided by the Orchestrator).',
    ),
  positions: z
    .array(
      z.object({
        bayse_event_id: z.string().min(1),
        market_id: z.string().min(1),
        outcome_id: z.string().min(1),
        share_quantity: z.number().positive(),
      }),
    )
    .describe(
      'List of live positions for this event (provided by the Orchestrator).',
    ),
});



export const llm_commit_execution_plan_schema = z.object({
  narrative_id: z
    .string()
    .min(1)
    .describe('Narrative identifier for the execution plan being committed.'),
  portfolio_id: z
    .string()
    .min(1)
    .describe('Portfolio identifier for the execution plan being committed.'),
  summary: z
    .string()
    .min(1)
    .optional()
    .describe('Optional short human-readable summary of the PM cycle.'),
  orders: z.array(
    z.object({
      event_id: z
        .string()
        .min(1)
        .describe(
          'Internal narrative event identifier the order is expressing.',
        ),
      bayse_event_id: z
        .string()
        .min(1)
        .describe(
          'Bayse parent event identifier required by Bayse quote and order endpoints.',
        ),
      market_id: z
        .string()
        .min(1)
        .describe('Bayse market identifier to trade.'),
      outcome_id: z
        .string()
        .min(1)
        .describe('Bayse outcome identifier for the side being traded.'),
      outcome_label: z
        .enum(['YES', 'NO'])
        .describe(
          'Bayse outcome label for the side being traded. Persist this alongside outcome_id.',
        ),
      action: z
        .enum(['BUY', 'SELL', 'REDUCE', 'LIQUIDATE'])
        .describe(
          'Execution action. BUY opens/adds, REDUCE partially exits, LIQUIDATE fully exits. Liquidate means sell full position share quantity.',
        ),
      fidelity_tag: z
        .enum(['EXACT', 'PROXY'])
        .optional()
        .describe(
          'Whether the market is an exact event expression or a proxy.',
        ),
      correlation_tier: z
        .enum(['EXACT', 'STRONG_PROXY', 'STANDARD_PROXY'])
        .optional()
        .describe(
          'PM classification tier for the market expression. EXACT requires expression_score >= 0.90, STRONG_PROXY = 0.70-0.89, STANDARD_PROXY = 0.40-0.69. Prefer Exact over Proxies. Use standard proxies as last resort.',
        ),
      expression_score: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          'Final event-to-market expression fidelity score. MANDATORY FORMULA: Result_Align * Semantic_Align * Temporal_Align * (1 - Basis_Risk_Penalty). Factors are 0.0-1.0. If ANY factor is 0, the total score MUST be 0. Do NOT use additive logic.',
        ),
      side: z
        .enum(['YES', 'NO'])
        .describe(
          'Which market side expresses the narrative event. Choose this from the market\'s semantic relationship to the event, not from probability thresholds.',
        ),
      share_quantity: z
        .number()
        .positive()
        .describe(
          'The number of shares to trade. MANDATORY SIZING: Max Target Capital = [Event_NAV] * (expression_score ^ 2). You must use Score-squared decay to starve weak proxies. Calculate share count as Target_Capital / market_price.',
        ),
      worst_acceptable_price: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          'Worst live price the Executor may accept. For BUY this is a maximum acceptable price. For SELL-like actions this is a minimum acceptable price. Base this on a fresh bayse_get_trade_quote.',
        ),
      reason: z
        .string()
        .min(1)
        .describe(
          'Quantitative justification for this order. MANDATORY EV PROOF: (Theoretical_Prob * Current_Target_Upside) - Friction_Cost > Current_Position_EV. If rotating, you must prove the new expression offsets the slippage and realized loss.',
        ),
      status: z
        .enum(['PENDING', 'ROUTED', 'FILLED', 'FAILED', 'CANCELLED'])
        .describe('Current local execution-plan status for this order. Set to PENDING.'),
    }),
  ).describe('The target trading orders. If no changes are needed, return an empty array.'),
});

export type CommitExecutionPlanInput = z.infer<
  typeof llm_commit_execution_plan_schema
>;

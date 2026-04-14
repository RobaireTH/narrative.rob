import { z } from 'zod';

export const bayse_execute_trade_schema = z.object({
  action: z
    .enum(['BUY', 'SELL', 'REDUCE', 'LIQUIDATE'])
    .describe('Execution action exactly as specified in the execution plan.'),
  bayse_event_id: z.string().min(1).describe('Bayse parent event identifier.'),
  market_id: z.string().min(1).describe('Bayse market identifier to trade.'),
  order_id: z.string().min(1).describe('Internal narrative order identifier from the execution plan.'),
  outcome_id: z.string().min(1).describe('Bayse outcome identifier for the side being traded.'),
  outcome_label: z.enum(['YES', 'NO']).describe('Bayse outcome label exactly as planned.'),
  share_quantity: z
    .number()
    .positive()
    .describe('Number of shares to execute exactly as planned.'),
  side: z.enum(['YES', 'NO']).describe('Bayse trade direction.'),
  worst_acceptable_price: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('The execution price gate. Reject the trade if the live price is worse than this.'),
});

export const commit_portfolio_update_schema = z.object({
  portfolio_id: z.string().min(1).describe('Portfolio identifier from the portfolio ledger.'),
  narrative_id: z.string().min(1).describe('Narrative identifier.'),
  receipts: z.array(
    z.object({
      action: z.enum(['BUY', 'SELL', 'REDUCE', 'LIQUIDATE']).describe('The action that was attempted.'),
      accounting_source: z.enum(['actual', 'quote_fallback']).optional().describe('Whether the receipt math comes from an actual fill or a quote override.'),
      actual_usdc_received: z.number().nonnegative().optional().describe('Cash received if the trade was a sell-type action.'),
      actual_usdc_spent: z.number().nonnegative().optional().describe('Cash spent if the trade was a buy-type action.'),
      blocked_by_price_guard: z.boolean().optional().describe('True if the execution price gate blocked the trade.'),
      error: z.string().min(1).optional().describe('Error message if the trade failed on the exchange.'),
      exchange_order_id: z.string().min(1).optional().describe('Receipt ID from the Bayse exchange.'),
      exchange_status: z.string().min(1).optional().describe('Order status returned by Bayse.'),
      fee_paid: z.number().nonnegative().optional().describe('Fees paid to the exchange in the transaction.'),
      live_execution_price: z.number().min(0).max(1).optional().describe('The actual clearing price of the trade.'),
      market_id: z.string().min(1).describe('Bayse market identifier traded.'),
      order_id: z.string().min(1).describe('Internal execution plan order ID.'),
      outcome_id: z.string().min(1).describe('Outcome traded on Bayse.'),
      outcome_label: z.enum(['YES', 'NO']).describe('Symmetric label for the outcome.'),
      shares_acquired: z.number().positive().optional().describe('Net shares obtained on a BUY.'),
      shares_sold: z.number().positive().optional().describe('Net shares cleared on a SELL/REDUCE/LIQUIDATE.'),
      success: z.boolean().describe('True if the order filled fully or partially; false if blocked or failed.'),
      worst_acceptable_price: z.number().min(0).max(1).optional().describe('The price limit that was enforced.'),
    })
  ).describe('The collection of exact exchange receipts generated during this cycle execution.'),
});

export type CommitPortfolioUpdateInput = z.infer<typeof commit_portfolio_update_schema>;
export type CommitPortfolioReceipt = CommitPortfolioUpdateInput['receipts'][number];

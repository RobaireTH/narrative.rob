import { z } from 'zod';

import {
  fidelity_tags,
  position_sides,
} from '../portfolio/schema';

export const execution_order_actions = [
  'BUY',
  'SELL',
  'REDUCE',
  'LIQUIDATE',
] as const;

export type ExecutionOrderAction = (typeof execution_order_actions)[number];

export const market_correlation_tiers = [
  'EXACT',
  'STRONG_PROXY',
  'STANDARD_PROXY',
] as const;

export type MarketCorrelationTier =
  (typeof market_correlation_tiers)[number];

export const execution_order_statuses = [
  'PENDING',
  'ROUTED',
  'FILLED',
  'FAILED',
  'CANCELLED',
] as const;

export type ExecutionOrderStatus = (typeof execution_order_statuses)[number];

export type ISO8601String = string;

/**
 * Planned execution order emitted by the Portfolio Manager.
 *
 * The payload stays intentionally lean. It should contain the minimum routing
 * data the Executor needs to safely place the trade plus a small amount of
 * audit context from the Portfolio Manager.
 */
export const execution_order_schema = z.object({
  order_id: z.string().min(1),
  event_id: z.string().min(1), // Narrative event/node identifier
  bayse_event_id: z.string().min(1),
  market_id: z.string().min(1),
  outcome_id: z.string().min(1),
  outcome_label: z.enum(position_sides),
  action: z.enum(execution_order_actions),
  fidelity_tag: z.enum(fidelity_tags).optional(),
  correlation_tier: z.enum(market_correlation_tiers).optional(),
  expression_score: z.number().min(0).max(1).optional(),
  side: z.enum(position_sides),
  share_quantity: z.number().positive(),
  // For BUY orders this is the maximum acceptable live price. For SELL-like
  // orders this is the minimum acceptable live price.
  worst_acceptable_price: z.number().min(0).max(1).optional(),
  reason: z.string().min(1),
  status: z.enum(execution_order_statuses),
});

export type ExecutionOrder = z.infer<typeof execution_order_schema>;

export const execution_plan_schema = z.object({
  narrative_id: z.string().min(1),
  portfolio_id: z.string().min(1),
  generated_at: z.string().datetime(),
  summary: z.string().min(1).optional(),
  orders: z.array(execution_order_schema),
});

export type ExecutionPlanJson = z.infer<typeof execution_plan_schema>;

export function create_empty_execution_plan(params: {
  generated_at: ISO8601String;
  narrative_id: string;
  portfolio_id: string;
  summary?: string;
}): ExecutionPlanJson {
  return {
    narrative_id: params.narrative_id,
    portfolio_id: params.portfolio_id,
    generated_at: params.generated_at,
    summary: params.summary,
    orders: [],
  };
}

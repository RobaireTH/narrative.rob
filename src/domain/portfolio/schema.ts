import { z } from 'zod';

export const currency_types = ["USD", "NGN"] as const;

export type CurrencyType = (typeof currency_types)[number];

export const position_statuses = [
  "OPEN",
  "AWAITING_RESOLUTION",
  "CLOSED_SOLD",
  "SETTLED_WIN",
  "SETTLED_LOSS",
] as const;

export type PositionStatus = (typeof position_statuses)[number];

export const fidelity_tags = [
  "EXACT", // Ground-truth oracle. Can resolve narrative events directly.
  "PROXY", // Correlated proxy. Cannot resolve narrative events.
] as const;

export type FidelityTag = (typeof fidelity_tags)[number];

export const position_sides = ["YES", "NO"] as const;

export type PositionSide = (typeof position_sides)[number];

export type ISO8601String = string;

export interface PortfolioPosition {
  position_id: string;
  event_id: string; // Narrative event/node identifier
  bayse_event_id: string; // Bayse parent event identifier
  market_id: string; // The specific Bayse contract ID
  outcome_id: string; // Bayse outcome ID used for pricing and execution
  outcome_label: PositionSide; // Bayse outcome label, always YES or NO
  status: PositionStatus;
  expression_score?: number;
  fidelity_tag: FidelityTag;
  side: PositionSide; // Betting for or against the event

  // Immutable Financial Facts (No derived state like unrealized PnL)
  entry_price: number;
  share_quantity: number;

  // Timestamps
  opened_at: ISO8601String;
  closed_at?: ISO8601String;
}

/**
 * Zod schema for one persisted portfolio position.
 */
export const portfolio_position_schema = z.object({
  position_id: z.string().min(1),
  event_id: z.string().min(1),
  bayse_event_id: z.string().min(1),
  market_id: z.string().min(1),
  outcome_id: z.string().min(1),
  outcome_label: z.enum(position_sides),
  status: z.enum(position_statuses),
  expression_score: z.number().min(0).max(1).optional(),
  fidelity_tag: z.enum(fidelity_tags),
  side: z.enum(position_sides),
  entry_price: z.number().nonnegative(),
  share_quantity: z.number().nonnegative(),
  opened_at: z.string().datetime(),
  closed_at: z.string().datetime().optional(),
});

export interface EventLedger {
  event_id: string;
  free_liquidity: number; // Unspent cash inside this isolated silo
  realized_pnl: number;
}

export interface PortfolioJson {
  portfolio_id: string;
  narrative_id: string;
  base_currency: CurrencyType;

  // Master Liquidity Pool (Only used at deposit and sweeping)
  unallocated_master_liquidity: number;

  // Isolated Capital Silos (VC Model)
  event_ledgers: EventLedger[];

  positions: PortfolioPosition[];
}

export const event_ledger_schema = z.object({
  event_id: z.string().min(1),
  free_liquidity: z.number().nonnegative(),
  realized_pnl: z.number(),
});

/**
 * Zod schema for the persisted portfolio ledger.
 */
export const portfolio_schema = z.object({
  portfolio_id: z.string().min(1),
  narrative_id: z.string().min(1),
  base_currency: z.enum(currency_types),
  unallocated_master_liquidity: z.number().nonnegative(),
  event_ledgers: z.array(event_ledger_schema),
  positions: z.array(portfolio_position_schema),
});

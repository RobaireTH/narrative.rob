import { createHash, createHmac } from 'crypto';

/**
 * Runtime configuration for the Bayse write-capable client used by the Executor.
 */
export interface BayseExecutorClientConfig {
  base_url?: string;
  currency?: string;
  public_key?: string;
  secret_key?: string;
  timeout_ms?: number;
}

/**
 * Structured HTTP error surfaced when Bayse returns a non-2xx response.
 */
export class BayseExecutorHttpError extends Error {
  readonly response_body?: string;
  readonly status: number;
  readonly url: string;

  constructor(params: {
    message: string;
    response_body?: string;
    status: number;
    url: string;
  }) {
    super(params.message);
    this.name = 'BayseExecutorHttpError';
    this.response_body = params.response_body;
    this.status = params.status;
    this.url = params.url;
  }
}

/**
 * Trade receipt returned by the executor trade tool.
 *
 * The LLM should reconcile the ledger from these fields rather than inventing
 * its own price or fee math.
 */
export interface ExecutorTradeReceipt {
  action: 'BUY' | 'SELL' | 'REDUCE' | 'LIQUIDATE';
  accounting_source?: 'actual' | 'quote_fallback';
  actual_usdc_received?: number;
  actual_usdc_spent?: number;
  blocked_by_price_guard?: boolean;
  error?: string;
  exchange_order_id?: string;
  exchange_status?: string;
  fee_paid?: number;
  live_execution_price?: number;
  market_id: string;
  order_id: string;
  outcome_id: string;
  outcome_label: 'YES' | 'NO';
  raw_order?: unknown;
  raw_quote?: unknown;
  shares_acquired?: number;
  shares_sold?: number;
  success: boolean;
  worst_acceptable_price?: number;
}

type BayseQuoteResponse = {
  amount?: number;
  completeFill?: boolean;
  costOfShares?: number;
  currencyBaseMultiplier?: number;
  currentMarketPrice?: number;
  fee?: number;
  price?: number;
  priceImpactAbsolute?: number;
  profitPercentage?: number;
  quantity?: number;
  tradeGoesOverMaxLiability?: boolean;
};

type BayseOrderPayload = {
  amount?: number;
  createdAt?: string;
  currency?: string;
  id?: string;
  outcome?: string;
  price?: number;
  quantity?: number;
  side?: string;
  status?: string;
  type?: string;
  updatedAt?: string;
};

type BayseOrderResponse = {
  engine?: string;
  order?: BayseOrderPayload;
};

function firstNumber(...values: Array<number | undefined>) {
  return values.find((value) => typeof value === 'number');
}

/**
 * Resolve Bayse write-client configuration from environment variables.
 */
export function resolveBayseExecutorClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): BayseExecutorClientConfig {
  const timeout_ms = Number(env.BAYSE_TIMEOUT_MS ?? 15_000);

  return {
    base_url: env.BAYSE_BASE_URL?.trim() || 'https://relay.bayse.markets',
    currency: env.BAYSE_CURRENCY?.trim() || 'USD',
    public_key: env.BAYSE_PUBLIC_KEY?.trim(),
    secret_key: env.BAYSE_SECRET_KEY?.trim(),
    timeout_ms: Number.isFinite(timeout_ms) ? timeout_ms : 15_000,
  };
}

/**
 * Concrete Bayse write client used by the Executor.
 *
 * It signs trade requests using the HMAC pattern documented in the local Bayse
 * reference file and returns normalized receipts for ledger reconciliation.
 */
export class BayseExecutorHttpClient {
  private readonly base_url: string;
  private readonly currency: string;
  private readonly public_key?: string;
  private readonly secret_key?: string;
  private readonly timeout_ms: number;

  constructor(config: BayseExecutorClientConfig = {}) {
    this.base_url = config.base_url ?? 'https://relay.bayse.markets';
    this.currency = config.currency ?? 'USD';
    this.public_key = config.public_key;
    this.secret_key = config.secret_key;
    this.timeout_ms = config.timeout_ms ?? 15_000;
  }

  /**
   * Compute the Bayse HMAC signature described in the local Bayse docs.
   */
  private createSignature(params: {
    body: string;
    method: 'POST';
    path: string;
    timestamp: string;
  }) {
    if (!this.secret_key) {
      throw new Error('BAYSE_SECRET_KEY is required for Bayse write access.');
    }

    const body_hash = createHash('sha256').update(params.body).digest('hex');
    const payload = `${params.timestamp}.${params.method}.${params.path}.${body_hash}`;

    return createHmac('sha256', this.secret_key)
      .update(payload)
      .digest('base64');
  }

  /**
   * Execute an authenticated POST request against Bayse.
   */
  private async signedPost<T>(path: string, body: unknown): Promise<T> {
    if (!this.public_key) {
      throw new Error('BAYSE_PUBLIC_KEY is required for Bayse write access.');
    }

    const body_string = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.createSignature({
      body: body_string,
      method: 'POST',
      path,
      timestamp,
    });
    const url = `${this.base_url.replace(/\/$/, '')}${path}`;

    const response = await fetch(url, {
      body: body_string,
      headers: {
        'content-type': 'application/json',
        'X-Public-Key': this.public_key,
        'X-Signature': signature,
        'X-Timestamp': timestamp,
      },
      method: 'POST',
      signal: AbortSignal.timeout(this.timeout_ms),
    });

    if (!response.ok) {
      const response_body = await response.text().catch(() => undefined);
      throw new BayseExecutorHttpError({
        message: `Bayse API request failed with status ${response.status}.`,
        response_body,
        status: response.status,
        url,
      });
    }

    return (await response.json()) as T;
  }

  /**
   * Quote the trade first so the executor can return normalized accounting
   * fields alongside the exchange order response.
   */
  private async getQuote(input: {
    amount: number;
    bayse_event_id: string;
    market_id: string;
    outcome_id: string;
    side: 'BUY' | 'SELL';
    outcome: 'YES' | 'NO';
  }): Promise<BayseQuoteResponse> {
    return this.signedPost<BayseQuoteResponse>(
      `/v1/pm/events/${encodeURIComponent(input.bayse_event_id)}/markets/${encodeURIComponent(input.market_id)}/quote`,
      {
        amount: input.amount,
        currency: this.currency,
        outcome: input.outcome,
        outcomeId: input.outcome_id,
        side: input.side,
      },
    );
  }

  /**
   * Approximate the Bayse `amount` parameter needed to quote a target share quantity.
   *
   * Bayse documents quotes as amount-based, while our execution plan currently
   * routes trades using share quantities. We bridge that mismatch by solving
   * for an amount whose returned quote quantity is close to the requested size.
   */
  private async resolveQuoteForShareQuantity(input: {
    bayse_event_id: string;
    market_id: string;
    outcome_id: string;
    outcome: 'YES' | 'NO';
    share_quantity: number;
    side: 'BUY' | 'SELL';
  }) {
    const target_quantity = input.share_quantity;
    const currency_multiplier = this.currency === 'NGN' ? 100 : 1;
    let low = 0;
    let high = Math.max(currency_multiplier * target_quantity, 1);
    let best_quote: BayseQuoteResponse | null = null;

    for (let iteration = 0; iteration < 12; iteration += 1) {
      const amount = (low + high) / 2;
      const quote = await this.getQuote({
        amount,
        bayse_event_id: input.bayse_event_id,
        market_id: input.market_id,
        outcome: input.outcome,
        outcome_id: input.outcome_id,
        side: input.side,
      });
      best_quote = quote;

      const quoted_quantity = quote.quantity ?? 0;
      if (Math.abs(quoted_quantity - target_quantity) <= Math.max(1e-6, target_quantity * 0.001)) {
        break;
      }

      if (quoted_quantity < target_quantity) {
        low = amount;
      } else {
        high = amount;
      }
    }

    return best_quote;
  }

  /**
   * Place the actual Bayse order after a successful quote.
   */
  private async placeOrder(input: {
    amount: number;
    bayse_event_id: string;
    market_id: string;
    outcome_id: string;
    side: 'BUY' | 'SELL';
  }): Promise<BayseOrderResponse> {
    return this.signedPost<BayseOrderResponse>(
      `/v1/pm/events/${encodeURIComponent(input.bayse_event_id)}/markets/${encodeURIComponent(input.market_id)}/orders`,
      {
        amount: input.amount,
        currency: this.currency,
        outcomeId: input.outcome_id,
        side: input.side,
        type: 'MARKET',
      },
    );
  }

  /**
   * Execute one trade and return a normalized receipt.
   *
   * Failures are returned as structured receipts instead of throwing so the
   * Executor agent can continue processing later orders in the same cycle.
   */
  async executeTrade(input: {
    action: 'BUY' | 'SELL' | 'REDUCE' | 'LIQUIDATE';
    bayse_event_id: string;
    market_id: string;
    order_id: string;
    outcome_id: string;
    outcome_label: 'YES' | 'NO';
    share_quantity: number;
    side: 'YES' | 'NO';
    worst_acceptable_price?: number;
  }): Promise<ExecutorTradeReceipt> {
    const exchange_side = input.action === 'BUY' ? 'BUY' : 'SELL';

    try {
      const solved_quote = await this.resolveQuoteForShareQuantity({
        bayse_event_id: input.bayse_event_id,
        market_id: input.market_id,
        outcome: input.side,
        outcome_id: input.outcome_id,
        share_quantity: input.share_quantity,
        side: exchange_side,
      });
      const live_execution_price =
        solved_quote?.price ?? solved_quote?.currentMarketPrice;
      const is_price_guard_broken =
        typeof live_execution_price === 'number' &&
        typeof input.worst_acceptable_price === 'number' &&
        (
          (exchange_side === 'BUY' &&
            live_execution_price > input.worst_acceptable_price) ||
          (exchange_side === 'SELL' &&
            live_execution_price < input.worst_acceptable_price)
        );

      if (is_price_guard_broken) {
        return {
          action: input.action,
          blocked_by_price_guard: true,
          error: 'SLIPPAGE_GUARD_TRIGGERED',
          live_execution_price,
          market_id: input.market_id,
          order_id: input.order_id,
          outcome_id: input.outcome_id,
          outcome_label: input.outcome_label,
          raw_quote: solved_quote,
          success: false,
          worst_acceptable_price: input.worst_acceptable_price,
        };
      }

      if (typeof solved_quote?.amount !== 'number') {
        return {
          action: input.action,
          error: 'BAYSE_QUOTE_AMOUNT_MISSING',
          market_id: input.market_id,
          order_id: input.order_id,
          outcome_id: input.outcome_id,
          outcome_label: input.outcome_label,
          raw_quote: solved_quote,
          success: false,
          worst_acceptable_price: input.worst_acceptable_price,
        };
      }

      const order = await this.placeOrder({
        amount: solved_quote.amount,
        bayse_event_id: input.bayse_event_id,
        market_id: input.market_id,
        outcome_id: input.outcome_id,
        side: exchange_side,
      });
      const order_payload = order.order;
      const executed_price =
        order_payload?.price ?? solved_quote?.price ?? solved_quote?.currentMarketPrice;
      const actual_spent = exchange_side === 'BUY' ? order_payload?.amount : undefined;
      const actual_received = exchange_side === 'SELL' ? order_payload?.amount : undefined;
      const actual_shares = order_payload?.quantity;
      const accounting_source =
        actual_spent !== undefined ||
        actual_received !== undefined ||
        actual_shares !== undefined
          ? 'actual'
          : 'quote_fallback';

      return exchange_side === 'BUY'
        ? {
            action: input.action,
            accounting_source,
            actual_usdc_spent: actual_spent ?? solved_quote?.amount,
            exchange_order_id: order_payload?.id,
            exchange_status: order_payload?.status,
            fee_paid: solved_quote?.fee,
            live_execution_price: executed_price,
            market_id: input.market_id,
            order_id: input.order_id,
            outcome_id: input.outcome_id,
            outcome_label: input.outcome_label,
            raw_order: order,
            raw_quote: solved_quote,
            shares_acquired: actual_shares ?? solved_quote?.quantity,
            success: true,
            worst_acceptable_price: input.worst_acceptable_price,
          }
        : {
            action: input.action,
            accounting_source,
            actual_usdc_received: actual_received ?? solved_quote?.amount,
            exchange_order_id: order_payload?.id,
            exchange_status: order_payload?.status,
            fee_paid: solved_quote?.fee,
            live_execution_price: executed_price,
            market_id: input.market_id,
            order_id: input.order_id,
            outcome_id: input.outcome_id,
            outcome_label: input.outcome_label,
            raw_order: order,
            raw_quote: solved_quote,
            shares_sold: actual_shares ?? solved_quote?.quantity,
            success: true,
            worst_acceptable_price: input.worst_acceptable_price,
          };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        action: input.action,
        error: message,
        market_id: input.market_id,
        order_id: input.order_id,
        outcome_id: input.outcome_id,
        outcome_label: input.outcome_label,
        success: false,
        worst_acceptable_price: input.worst_acceptable_price,
      };
    }
  }
}

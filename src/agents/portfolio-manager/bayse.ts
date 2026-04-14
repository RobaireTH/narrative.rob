import type {
  PortfolioManagerBayseSearchEvent,
  PortfolioManagerBayseMarketState,
  PortfolioManagerPositionValuation,
  PortfolioManagerTradeQuote,
} from "./tools";

/**
 * Runtime configuration for the read-only Bayse client used by the Portfolio Manager.
 */
export interface BaysePortfolioManagerClientConfig {
  base_url?: string;
  currency?: string;
  market_fetch_limit?: number;
  max_pages?: number;
  public_key?: string;
  series_slug?: string;
  timeout_ms?: number;
}

/**
 * Structured HTTP error surfaced when Bayse returns a non-2xx response.
 */
export class BaysePortfolioManagerHttpError extends Error {
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
    this.name = "BaysePortfolioManagerHttpError";
    this.response_body = params.response_body;
    this.status = params.status;
    this.url = params.url;
  }
}

/**
 * Small JSON request helper for the Bayse read-only client.
 */
async function fetchJson<T>(params: {
  body?: unknown;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  timeout_ms?: number;
  url: string;
}): Promise<T> {
  const response = await fetch(params.url, {
    body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
    headers: {
      ...(params.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...params.headers,
    },
    method: params.method ?? "GET",
    signal: AbortSignal.timeout(params.timeout_ms ?? 15_000),
  });

  if (!response.ok) {
    const response_body = await response.text().catch(() => undefined);
    throw new BaysePortfolioManagerHttpError({
      message: `Bayse API request failed with status ${response.status}.`,
      response_body,
      status: response.status,
      url: params.url,
    });
  }

  return (await response.json()) as T;
}

/**
 * Resolve Bayse read-only client configuration from environment variables.
 */
export function resolveBaysePortfolioManagerClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): BaysePortfolioManagerClientConfig {
  const timeout_ms = Number(env.BAYSE_TIMEOUT_MS ?? 15_000);
  const market_fetch_limit = Number(env.BAYSE_MARKET_FETCH_LIMIT ?? 50);
  const max_pages = Number(env.BAYSE_MAX_PAGES ?? 10);

  return {
    base_url: env.BAYSE_BASE_URL?.trim() || "https://relay.bayse.markets",
    currency: env.BAYSE_CURRENCY?.trim() || "USD",
    market_fetch_limit: Number.isFinite(market_fetch_limit)
      ? market_fetch_limit
      : 50,
    max_pages: Number.isFinite(max_pages) ? max_pages : 10,
    public_key: env.BAYSE_PUBLIC_KEY?.trim(),
    series_slug: env.BAYSE_SERIES_SLUG?.trim(),
    timeout_ms: Number.isFinite(timeout_ms) ? timeout_ms : 15_000,
  };
}

type BayseRawOutcomeBookLevel = {
  price: number;
  quantity: number;
  total: number;
};

type BayseRawBook = {
  marketId: string;
  outcomeId: string;
  asks: BayseRawOutcomeBookLevel[];
  bids: BayseRawOutcomeBookLevel[];
};

type BayseRawEvent = {
  closingDate?: string;
  id: string;
  description: string;
  type: string;
  engine: string;
  resolutionDate: string;
  liquidity: number;
  totalVolume: number;
  totalOrders: number;
  supportedCurrencies: ["USD", "NGN"];
  userWatchlisted: false;

  markets: BayseRawMarket[];
  status: string;
  title: string;
};

type BayseRawMarket = {
  id: string;
  title: string;
  status?: string;
  outcome1Id?: string;
  outcome1Label?: string;
  outcome1Price?: number;
  outcome2Id?: string;
  outcome2Label?: string;
  outcome2Price?: number;
  yesBuyPrice: number;
  noBuyPrice: number;
  feePercentage: number;
  totalOrder: number;
  rules: string;
};

type BayseEventsResponse = {
  events?: BayseRawEvent[];
};

type BayseQuoteResponse = {
  amount: number;
  completeFill: boolean;
  costOfShares: number;
  currencyBaseMultiplier: number;
  currentMarketPrice: number;
  fee: number;
  price: number;
  priceImpactAbsolute: number;
  profitPercentage: number;
  quantity: number;
  tradeGoesOverMaxLiability: boolean;
};

/**
 * Concrete read-only Bayse client used by the Portfolio Manager.
 *
 * This client implements market discovery, orderbook inspection, and position
 * valuation using Bayse's published prediction-market REST endpoints.
 */
export class BaysePortfolioManagerHttpClient {
  private readonly base_url: string;
  private readonly currency: string;
  private readonly headers?: Record<string, string>;
  private readonly market_fetch_limit: number;
  private readonly max_pages: number;
  private readonly timeout_ms: number;

  constructor(config: BaysePortfolioManagerClientConfig = {}) {
    this.base_url = config.base_url ?? "https://relay.bayse.markets";
    this.currency = config.currency ?? "USD";
    this.market_fetch_limit = config.market_fetch_limit ?? 50;
    this.max_pages = config.max_pages ?? 10;
    this.timeout_ms = config.timeout_ms ?? 15_000;
    this.headers = config.public_key
      ? {
        "X-Public-Key": config.public_key,
      }
      : undefined;
  }

  /**
   * Run a GET request under the configured Bayse relay host.
   */
  private async get<T>(path: string): Promise<T> {
    const url = `${this.base_url.replace(/\/$/, "")}${path}`;
    return fetchJson<T>({
      headers: this.headers,
      timeout_ms: this.timeout_ms,
      url,
    });
  }

  /**
   * Run a POST request under the configured Bayse relay host.
   */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.base_url.replace(/\/$/, "")}${path}`;
    return fetchJson<T>({
      body,
      headers: this.headers,
      method: "POST",
      timeout_ms: this.timeout_ms,
      url,
    });
  }

  private async getEvent(event_id: string): Promise<BayseRawEvent> {
    const params = new URLSearchParams({
      currency: this.currency,
    });

    const event = await this.get<BayseRawEvent>(
      `/v1/pm/events/${event_id}?${params}`,
    );

    return event;
  }
  /**
   * Fetch Bayse events across multiple pages, optionally scoped by status and keyword.
   */
  private async getEvents(
    options: {
      keyword?: string;
      status?: string;
    } = {},
  ): Promise<BayseRawEvent[]> {
    const events: BayseRawEvent[] = [];

    // Fetch pages sequentially for now so we can:
    // 1. stop early when the final page is reached
    // 2. avoid spiking read load until Bayse rate-limit behavior is better characterized
    for (let page = 1; page <= this.max_pages; page += 1) {
      const params = new URLSearchParams({
        currency: this.currency,
        page: String(page),
        size: String(this.market_fetch_limit),
      });

      params.set("status", options.status ? options.status : "open");

      if (options.keyword) {
        params.set("keyword", options.keyword);
      }

      const data = await this.get<BayseEventsResponse>(
        `/v1/pm/events?${params}`,
      );
      const batch = data.events ?? [];
      events.push(...batch);

      if (batch.length < this.market_fetch_limit) {
        break;
      }
    }

    return events;
  }

  /**
   * Request a quote from Bayse for a simulated sell.
   *
   * The public docs explicitly show quote-based pricing in the trading flow, so
   * PM valuation uses that same path instead of book-derived estimates.
   */
  private async getSellQuote(input: {
    amount: number;
    bayse_event_id: string;
    market_id: string;
    outcome_id: string;
  }): Promise<BayseQuoteResponse> {
    return this.post<BayseQuoteResponse>(
      `/v1/pm/events/${encodeURIComponent(input.bayse_event_id)}/markets/${encodeURIComponent(input.market_id)}/quote`,
      {
        amount: input.amount,
        outcomeId: input.outcome_id,
        side: "SELL",
      },
    );
  }

  /**
   * Request a fresh Bayse quote using the documented amount-based API.
   */
  private async getQuote(input: {
    amount: number;
    bayse_event_id: string;
    market_id: string;
    outcome_id?: string;
    side: "BUY" | "SELL";
  }): Promise<BayseQuoteResponse> {
    return this.post<BayseQuoteResponse>(
      `/v1/pm/events/${encodeURIComponent(input.bayse_event_id)}/markets/${encodeURIComponent(input.market_id)}/quote`,
      {
        amount: input.amount,
        currency: this.currency,
        outcomeId: input.outcome_id,
        side: input.side,
      },
    );
  }

  /**
   * Approximate the Bayse `amount` parameter needed to quote a target share quantity.
   *
   * Bayse documents quotes as amount-based, while our PM currently reasons in
   * share quantities for position valuation. We solve this mismatch by searching
   * for an amount whose returned quote quantity is close to the target.
   */
  private async resolveSellQuoteForShareQuantity(input: {
    bayse_event_id: string;
    market_id: string;
    outcome_id: string;
    share_quantity: number;
  }): Promise<BayseQuoteResponse | null> {
    const target_quantity = input.share_quantity;
    const currency_multiplier = this.currency === "NGN" ? 100 : 1;
    let low = 0;
    let high = Math.max(currency_multiplier * target_quantity, 1);
    let best_quote: BayseQuoteResponse | null = null;

    for (let iteration = 0; iteration < 12; iteration += 1) {
      const amount = (low + high) / 2;
      const quote = await this.getSellQuote({
        amount,
        bayse_event_id: input.bayse_event_id,
        market_id: input.market_id,
        outcome_id: input.outcome_id,
      });
      best_quote = quote;

      const quoted_quantity = quote.quantity ?? 0;
      if (
        Math.abs(quoted_quantity - target_quantity) <=
        Math.max(1e-6, target_quantity * 0.001)
      ) {
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
   * Search candidate markets by pulling active events and ranking them locally
   * against the target event and narrative text.
   */
  async searchMarkets(input: {
    keyword: string;
    limit?: number;
  }): Promise<PortfolioManagerBayseSearchEvent[]> {
    const events = await this.getEvents({
      keyword: input.keyword,
      status: "open",
    });
    return events;
  }

  /**
   * Quote a prospective BUY or SELL directly in Bayse's amount-based format.
   */
  async getTradeQuote(input: {
    amount: number;
    bayse_event_id: string;
    market_id: string;
    outcome_id: string;
    outcome_label: "YES" | "NO";
    side: "BUY" | "SELL";
  }): Promise<PortfolioManagerTradeQuote> {
    const quote = await this.getQuote({
      amount: input.amount,
      bayse_event_id: input.bayse_event_id,
      market_id: input.market_id,
      outcome_id: input.outcome_id,
      side: input.side,
    });

    return {
      ...quote,
      market_id: input.market_id,
      outcome_id: input.outcome_id,
      outcome_label: input.outcome_label,
      side: input.side,
    };
  }

  /**
   * Fetch one Bayse event by id so the PM can reason about whether positions
   * are still tradable or are now awaiting resolution/settlement.
   */
  async getMarketState(input: {
    market_id: string;
    bayse_event_id: string;
  }): Promise<PortfolioManagerBayseMarketState> {
    const event = await this.getEvent(input.bayse_event_id);

    let ref_market;
    for (const market of event.markets) {
      if (market.id == input.market_id) {
        ref_market = market;
        break;
      }
    }

    if (!ref_market) {
      return {
        is_resolved: false,
        is_tradable: false,
        market_id: input.market_id,
      };
    }

    const event_status = event.status?.toLowerCase();
    const market_status = ref_market.status?.toLowerCase();
    const effective_status = market_status ?? event_status;
    const is_tradable = effective_status === "open";
    const is_resolved =
      effective_status === "resolved" ||
      (ref_market.outcome1Price === 1 && ref_market.outcome2Price === 0) ||
      (ref_market.outcome1Price === 0 && ref_market.outcome2Price === 1);

    return {
      is_resolved,
      is_tradable,
      market_id: ref_market.id,
      outcome1_id: ref_market.outcome1Id,
      outcome1_label: ref_market.outcome1Label,
      outcome1_price: ref_market.outcome1Price,
      outcome2_id: ref_market.outcome2Id,
      outcome2_label: ref_market.outcome2Label,
      outcome2_price: ref_market.outcome2Price,
      status: ref_market.status ?? event.status,
    };
  }

  /**
   * Fetch top-of-book information for one outcome so the PM can reason about
   * current liquidity and marginal pricing.
   */
  async getMarketOrderbook(input: { outcome_id: string }): Promise<{
    available_liquidity: number;
    bids: BayseRawOutcomeBookLevel[];
    asks: BayseRawOutcomeBookLevel[];
    currency: string;
    outcome_id: string;
  }> {
    const params = new URLSearchParams();
    params.append("outcomeId[]", input.outcome_id);
    params.append("currency", this.currency);
    params.append("depth", "5");

    const data = await this.get<BayseRawBook[] | BayseRawBook>(
      `/v1/pm/books?${params}`,
    );
    const first_book = Array.isArray(data) ? (data[0] ?? {}) : (data ?? {});
    const bids = first_book.bids;

    let totalBidLiquidity = 0;
    bids.forEach((bid) => {
      totalBidLiquidity += bid.total;
    });

    const asks = first_book.asks;

    let totalAskLiquidity = 0;

    asks.forEach((ask) => {
      totalAskLiquidity += ask.total;
    });

    return {
      available_liquidity: totalAskLiquidity + totalBidLiquidity,
      asks,
      bids,
      currency: this.currency,
      outcome_id: input.outcome_id,
    };
  }

  /**
   * Estimate current position value from quote-based simulated sell output.
   *
   * If Bayse cannot produce a sell quote, we conservatively write the position
   * down to zero rather than hallucinating liquidity or halting the PM cycle.
   */
  async estimatePositionValue(input: {
    market_id: string;
    bayse_event_id: string;
    outcome_id: string;
    share_quantity: number;
  }): Promise<PortfolioManagerPositionValuation> {
    try {
      const sell_quote = await this.resolveSellQuoteForShareQuantity({
        bayse_event_id: input.bayse_event_id,
        market_id: input.market_id,
        outcome_id: input.outcome_id,
        share_quantity: input.share_quantity,
      });

      if (!sell_quote || typeof sell_quote.amount !== "number") {
        return {
          currency: this.currency,
          estimated_value: 0,
          mark_price: 0,
          outcome_id: input.outcome_id,
        };
      }

      return {
        currency: this.currency,
        estimated_value: sell_quote.amount,
        mark_price: sell_quote.price ?? sell_quote.currentMarketPrice,
        outcome_id: input.outcome_id,
      };
    } catch {
      return {
        currency: this.currency,
        estimated_value: 0,
        mark_price: 0,
        outcome_id: input.outcome_id,
      };
    }
  }
}

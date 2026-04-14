import { z } from "zod";

/**
 * Supported authentication modes for CoinGecko.
 *
 * - `demo` uses the demo API-key header
 * - `pro` uses the pro API-key header
 * - `none` makes unauthenticated requests
 */
export const coingecko_auth_modes = ["demo", "pro", "none"] as const;
export type CoinGeckoAuthMode = (typeof coingecko_auth_modes)[number];

/**
 * Runtime configuration for the CoinGecko client.
 *
 * The client is intentionally narrow: it only supports validated HTTPS GET
 * requests against the configured CoinGecko API base URL.
 */
export interface CoinGeckoClientConfig {
  api_key?: string;
  auth_mode?: CoinGeckoAuthMode;
  base_url?: string;
  timeout_ms?: number;
}

/**
 * Minimal input contract for the dynamic CoinGecko tool.
 *
 * The agent supplies one full HTTPS URL and the client ensures that it still
 * points at the configured CoinGecko host and API prefix.
 */
export const coingecko_api_request_schema = z.object({
  url: z
    .url()
    .startsWith("https://")
    .describe(
      "A full HTTPS CoinGecko GET request URL, for example https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    ),
});

export type CoinGeckoApiRequest = z.infer<typeof coingecko_api_request_schema>;

/**
 * Rich tool description for the dynamic CoinGecko tool.
 *
 * This acts as the endpoint guide for the researcher, replacing the older
 * "one schema per endpoint" approach with a flexible URL-driven interface.
 */
export const coingecko_api_request_tool_description = `
Run a GET request against the CoinGecko REST API and return the raw JSON response.

Input:
- url: a full HTTPS request URL under the configured CoinGecko API base URL, usually https://api.coingecko.com/api/v3 or https://pro-api.coingecko.com/api/v3

Use this tool dynamically when you know the endpoint you need. If you only know a symbol or a rough asset name, call a discovery endpoint like /search, /coins/list, or /asset_platforms first, then follow up with a price or metadata endpoint.

Common endpoint families and what they return:
- /simple/price?ids=bitcoin,ethereum&vs_currencies=usd
  Returns an object keyed by coin ID, e.g. { "bitcoin": { "usd": 70000, "usd_market_cap": ..., "usd_24h_vol": ..., "usd_24h_change": ..., "last_updated_at": ... } }
- /simple/token_price/{asset_platform_id}?contract_addresses=0x...&vs_currencies=usd
  Returns an object keyed by contract address, e.g. { "0x...": { "usd": ..., "usd_market_cap": ..., "usd_24h_vol": ..., "usd_24h_change": ..., "last_updated_at": ... } }
- /coins/markets?vs_currency=usd&ids=bitcoin,ethereum
  Returns an array of market snapshots with fields such as id, symbol, name, image, current_price, market_cap, market_cap_rank, total_volume, circulating_supply, total_supply, ath, atl, and price_change_percentage_24h
- /coins/{id}?localization=false&tickers=false&market_data=true
  Returns a detailed coin object with metadata, platforms, categories, description, market_cap_rank, and nested market_data
- /coins/{id}/market_chart?vs_currency=usd&days=30
  Returns time-series arrays like prices, market_caps, and total_volumes
- /coins/list?include_platform=true
  Returns an array of coin IDs, symbols, names, and optional platforms mapping
- /asset_platforms
  Returns asset-platform metadata such as id, chain_identifier, name, shortname, native_coin_id, and image
- /search?query=ethereum
  Returns grouped discovery results including coins, exchanges, categories, and nfts
- /global
  Returns broad market stats such as total_market_cap, total_volume, market_cap_percentage, and updated_at
- /exchange_rates
  Returns a rates object keyed by currency code with name, unit, value, and type

Examples:
- Get BTC spot price in USD:
  https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true
- Find the coin ID for Optimism:
  https://api.coingecko.com/api/v3/search?query=optimism
- Get detailed metadata for bitcoin:
  https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true
- Get token price by contract on Ethereum:
  https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=0x2260fac5e5542a773aa44fbcfedf7c193bc2c599&vs_currencies=usd&include_market_cap=true&include_24hr_change=true
- Get top market data by category:
  https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=ethereum-ecosystem&order=market_cap_desc&per_page=25&page=1

Only GET requests are supported. The tool automatically applies CoinGecko auth headers when configured.
`.trim();

/**
 * Small internal fetch config for JSON-based CoinGecko requests.
 */
interface JsonRequestParams {
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  timeout_ms?: number;
  url: string;
}

/**
 * Structured HTTP error surfaced when CoinGecko returns a non-2xx response.
 */
export class CoinGeckoHttpError extends Error {
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
    this.name = "CoinGeckoHttpError";
    this.response_body = params.response_body;
    this.status = params.status;
    this.url = params.url;
  }
}

/**
 * Execute a JSON request and throw a typed error on non-2xx responses.
 */
async function fetchJson<T>(params: JsonRequestParams): Promise<T> {
  // CoinGecko requests are GET-only in the current design and always expect JSON.
  const response = await fetch(params.url, {
    method: params.method ?? "GET",
    headers: params.headers,
    signal: AbortSignal.timeout(params.timeout_ms ?? 15_000),
  });

  // Preserve response context so debugging bad URLs or rate-limit issues is easier.
  if (!response.ok) {
    const response_body = await response.text().catch(() => undefined);
    throw new CoinGeckoHttpError({
      message: `CoinGecko API request failed with status ${response.status}.`,
      response_body,
      status: response.status,
      url: params.url,
    });
  }

  // The tool returns parsed JSON so the outer LangChain tool can stringify it.
  return (await response.json()) as T;
}

/**
 * Resolve CoinGecko configuration from environment variables.
 *
 * This keeps local setup lightweight by deriving sensible defaults for public,
 * demo, and pro usage.
 */
export function resolveCoinGeckoClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): CoinGeckoClientConfig {
  // Respect an explicit mode first because the caller may want to override inference.
  const explicit_auth_mode = env.COINGECKO_AUTH_MODE?.trim();
  const auth_mode: CoinGeckoAuthMode =
    explicit_auth_mode === "demo" ||
    explicit_auth_mode === "pro" ||
    explicit_auth_mode === "none"
      ? explicit_auth_mode
      : env.COINGECKO_BASE_URL?.includes("pro-api.coingecko.com")
        ? "pro"
        : env.COINGECKO_API_KEY
          ? "demo"
          : "none";

  // Parse timeout once and fall back to a safe default.
  const timeout_ms = Number(env.COINGECKO_TIMEOUT_MS ?? 15_000);

  return {
    api_key: env.COINGECKO_API_KEY?.trim(),
    auth_mode,
    base_url:
      env.COINGECKO_BASE_URL?.trim() ||
      (auth_mode === "pro"
        ? "https://pro-api.coingecko.com/api/v3"
        : "https://api.coingecko.com/api/v3"),
    timeout_ms: Number.isFinite(timeout_ms) ? timeout_ms : 15_000,
  };
}

/**
 * Thin CoinGecko HTTP client used by the researcher tool layer.
 *
 * The agent chooses the endpoint dynamically, but the client still enforces the
 * host, path prefix, auth header, and JSON parsing rules.
 */
export class CoinGeckoClient {
  private readonly api_key?: string;
  private readonly auth_mode: CoinGeckoAuthMode;
  private readonly base_url: string;
  private readonly timeout_ms: number;

  /**
   * Create a CoinGecko client with optional auth and host overrides.
   */
  constructor(config: CoinGeckoClientConfig = {}) {
    this.api_key = config.api_key;
    this.auth_mode = config.auth_mode ?? "none";
    this.base_url =
      config.base_url ??
      (this.auth_mode === "pro"
        ? "https://pro-api.coingecko.com/api/v3"
        : "https://api.coingecko.com/api/v3");
    this.timeout_ms = config.timeout_ms ?? 15_000;
  }

  /**
   * Parse the configured base URL once when validating request URLs.
   */
  private getBaseUrl() {
    return new URL(this.base_url);
  }

  /**
   * Ensure the agent-supplied URL remains a CoinGecko API request.
   *
   * This is the safety rail that keeps the dynamic URL approach from turning
   * into an arbitrary cross-host fetch tool.
   */
  private validateRequestUrl(request_url: string) {
    const parsed = new URL(request_url);
    const base = this.getBaseUrl();
    const normalized_base_path = base.pathname.replace(/\/$/, "");

    // Only allow HTTPS requests.
    if (parsed.protocol !== "https:") {
      throw new Error("CoinGecko API requests must use HTTPS.");
    }

    // Disallow embedded credentials entirely.
    if (parsed.username || parsed.password) {
      throw new Error(
        "CoinGecko API request URLs must not contain credentials.",
      );
    }

    // Lock the request to the configured CoinGecko host.
    if (parsed.origin !== base.origin) {
      throw new Error(
        `CoinGecko API request host must match configured base host ${base.origin}.`,
      );
    }

    // Keep the request under the configured API prefix, usually `/api/v3`.
    if (
      parsed.pathname !== normalized_base_path &&
      !parsed.pathname.startsWith(`${normalized_base_path}/`)
    ) {
      throw new Error(
        `CoinGecko API request path must stay under ${normalized_base_path}.`,
      );
    }

    return parsed.toString();
  }

  /**
   * Build the correct CoinGecko auth header for the configured mode.
   */
  private getHeaders() {
    if (!this.api_key || this.auth_mode === "none") {
      return undefined;
    }

    // Build headers imperatively so the result stays strongly typed.
    const headers: Record<string, string> = {};
    if (this.auth_mode === "pro") {
      headers["x-cg-pro-api-key"] = this.api_key;
    } else {
      headers["x-cg-demo-api-key"] = this.api_key;
    }

    return headers;
  }

  /**
   * Execute a validated CoinGecko GET request and return the parsed JSON body.
   */
  async request(input: CoinGeckoApiRequest): Promise<unknown> {
    // Validate the input shape first.
    const request = coingecko_api_request_schema.parse(input);
    // Then validate the URL against the configured CoinGecko base URL.
    const validated_url = this.validateRequestUrl(request.url);

    // Finally perform the authenticated request.
    return fetchJson<unknown>({
      headers: this.getHeaders(),
      timeout_ms: this.timeout_ms,
      url: validated_url,
    });
  }
}

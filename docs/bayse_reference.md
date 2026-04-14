# Bayse Documentation Reference

This file is a local engineering reference distilled from the public Bayse docs at `docs.bayse.markets`.

Purpose:
- keep the Bayse platform model and endpoint catalog close to the codebase
- reduce repeated re-browsing for common implementation work
- document the assumptions currently used by the Narrative runtime agents

This is a summarized internal reference, not a verbatim mirror.

## Source Coverage

This reference was compiled from these public Bayse docs pages:

- `Introduction`
- `Quickstart`
- `Authentication`
- `Rate limits`
- `Examples`
- `Prediction markets`
- `Events, markets & outcomes`
- `Market engines`
- `Multi-currency support`
- `Fees`
- `Trading flow`
- `Order lifecycle`
- `Market data`
- `Liquidity rewards`
- `FAQ`
- `API reference`

## Platform Overview

Bayse is a prediction-market platform centered on binary outcome trading.

Key platform ideas:

- Markets are grouped under events.
- Each market has exactly two outcomes.
- Outcome prices behave like probabilities and approximately sum to `1.00`.
- Winning outcome shares settle to `1.00 × currency base multiplier`.
- Losing outcome shares settle to `0.00`.
- Bayse supports both:
  - `AMM` execution
  - `CLOB` execution

Base production URL:

```text
https://relay.bayse.markets
```

## Documentation Tree

### Getting Started

- `Introduction`
  Bayse positions itself as a multi-engine, multi-currency prediction-market platform with real-time data and HMAC-authenticated API access.
- `Quickstart`
  Shows the standard workflow:
  1. login
  2. create API key
  3. make a read request
  4. make a signed write request
- `Authentication`
  Defines the auth levels and HMAC signing format.
- `Rate limits`
  Documents API rate limiting and `429` behavior.
- `Examples`
  High-level example categories such as event search, trade quotes, orders, portfolio access, and historical market data.

### Core Concepts

- `Prediction markets`
  Explains Yes/No style probability markets and how payouts work.
- `Events, markets & outcomes`
  Defines the Bayse data hierarchy:
  - Event -> Market -> Outcome
- `Event series`
  Documentation tree includes event-series concepts and API endpoints for listing series and their events.
- `Market engines`
  Explains:
  - `AMM` = instant algorithmic pricing
  - `CLOB` = orderbook trading with bids/asks
- `Multi-currency support`
  Explains currency multipliers and how price probabilities convert into currency-denominated amounts.
- `Fees`
  Bayse fees are included in quote responses and are variance-based with a hard cap.
- `Trading flow`
  Browse -> quote -> place order -> inspect portfolio.
- `Order lifecycle`
  Explains order types, time-in-force, and order statuses.
- `Market data`
  Covers price history, orderbook, trades, ticker, and WebSocket for streaming.
- `Liquidity rewards`
  CLOB markets may have maker reward programs tied to resting liquidity quality.

### Support

- `FAQ`
  Covers basic trading mechanics, cancellation, settlement, and currency behavior.

## Core Data Model

Bayse uses a three-level hierarchy:

- `Event`
  The top-level topic or question container.
- `Market`
  A tradeable question inside an event.
- `Outcome`
  One of the two binary sides of a market.

Important consequences:

- Bayse market exposure is ultimately outcome-specific.
- For pricing and orderbook reads, outcome identifiers matter.
- For quoting and order placement, both event-level and market-level identifiers matter.

## Market Engines

### AMM

- No orderbook
- Instant execution
- Price shifts after each trade
- Liquidity is always present, but depth depends on the market

Typical AMM trade body:

```json
{
  "side": "BUY",
  "outcome": "YES",
  "amount": 100,
  "currency": "USD"
}
```

### CLOB

- Traditional bids and asks
- Limit orders supported
- Depth depends on participant liquidity
- Market data endpoints like orderbook/ticker/trades are especially relevant

Typical CLOB trade body:

```json
{
  "side": "BUY",
  "outcome": "YES",
  "amount": 100,
  "price": 0.65,
  "currency": "USD"
}
```

## Multi-Currency Model

Docs currently mention support for:

- `USD`
- `NGN`

Important rule:

- Prices are probabilities between `0.00` and `1.00`
- Cost per share = `price × currency base multiplier`

Examples from docs:

- `USD` multiplier = `1`
- `NGN` multiplier = `100`

So:

- `0.65` in USD = `$0.65/share`
- `0.65` in NGN = `₦65.00/share`

If no currency is specified, Bayse defaults to `USD`.

## Trading Flow

The Bayse trading flow in the docs is:

1. Browse events
2. Get quote
3. Place order
4. View portfolio

Example browse:

```text
GET /v1/pm/events?category=sports&status=open
```

Example quote:

```text
POST /v1/pm/events/{eventId}/markets/{marketId}/quote
```

Example quote body:

```json
{
  "side": "BUY",
  "outcome": "YES",
  "amount": 100
}
```

Example quote response:

```json
{
  "expectedPrice": 0.6532,
  "expectedShares": 153.12,
  "fee": 2.50,
  "total": 102.50
}
```

This quote-first design matters for our PM:

- Bayse explicitly models quote-before-trade
- fees are visible at quote time
- quote output is the best available source for “what would I actually get/pay right now”

## Order Lifecycle

### Time In Force

- `GTC` = Good Till Cancel
- `FAK` = Fill and Kill
- `FOK` = Fill or Kill
- `GTD` = Good Till Date

### Order Types

- `Limit`
- `Market`

### Order Statuses

- `pending`
- `open`
- `partial_filled`
- `filled`
- `cancelled`
- `rejected`
- `expired`

For our runtime:

- `Executor` will care about placement and cancellation semantics
- `PM` mostly needs to understand liquidity and orderbook shape

## Fees

Bayse docs say fees are included in quote responses.

Fee behavior:

- variance-based formula
- depends on fee rate, price, and quantity
- capped at `$1,000` per trade

Implementation consequence:

- when possible, planning and execution should prefer quote-derived costs over hand-estimated fee math

## Liquidity Rewards

Bayse rewards CLOB liquidity providers for resting limit orders.

Key concepts:

- reward program appears as `liquidityReward` in market/event data
- fields shown in docs include:
  - `configId`
  - `rewardPool`
  - `maxSpreadCents`
  - `minNotionalOrderSize`
- scoring depends on quote quality and distance from midpoint

This is not yet used in the current runtime, but it could become relevant for future tactical/maker strategies.

## Authentication Model

Bayse docs define four practical auth levels:

- `Public`
  No auth required
- `Session`
  `x-auth-token` + `x-device-id`
- `Read`
  `X-Public-Key`
- `Write`
  `X-Public-Key` + `X-Timestamp` + `X-Signature`

### API Keys

Bayse API keys come in pairs:

- `pk_*` public key
- `sk_*` secret key

The secret key is shown only once at creation time.

### Write Signing Format

Payload to sign:

```text
{timestamp}.{METHOD}.{path}.{bodyHash}
```

Where:

- `timestamp` is Unix time in seconds
- `METHOD` is uppercase HTTP method
- `path` is the request path only
- `bodyHash` is the SHA-256 hex digest of raw body bytes, or empty string for no body

The resulting HMAC-SHA256 signature is base64 encoded and sent in `X-Signature`.

### Login / Session Token

Login endpoint:

```text
POST /v1/user/login
```

Example response fields:

- `token`
- `deviceId`
- `userId`

The docs say login is rate-limited to 1 request per 2 minutes per email.

## Rate Limits

Bayse returns:

- HTTP `429 Too Many Requests`
- `Retry-After` header
- `retryAfter` field in the response body

Implementation consequence:

- Bayse clients should be prepared for backoff/retry logic
- Orchestrator and Executor should avoid naive retry loops

## API Reference

The docs say list endpoints use:

- `page`
- `size`

Paginated responses include:

```json
{
  "pagination": {
    "page": 1,
    "size": 20,
    "lastPage": 5,
    "totalCount": 98
  }
}
```

The docs also mention optional tracing:

- `x-trace-id`

which is echoed back in response headers.

## Endpoint Catalog

Below is the API endpoint catalog exposed by Bayse’s public docs, grouped by category.

### System

#### `GET /health`

- Purpose:
  Service health check
- Auth:
  Public
- Returns:
  Health status for the relay/service

#### `GET /version`

- Purpose:
  Service version information
- Auth:
  Public
- Returns:
  Version/build metadata

### User

#### `POST /v1/user/login`

- Purpose:
  Exchange account credentials for session token + device ID
- Auth:
  Public login using email/password
- Returns:
  Session payload with:
  - `token`
  - `deviceId`
  - `userId`

#### `POST /v1/user/me/api-keys`

- Purpose:
  Create a new API key pair
- Auth:
  Session
- Returns:
  API key record including:
  - `id`
  - `publicKey`
  - `secretKey`
  - `name`
  - `createdAt`

#### `GET /v1/user/me/api-keys`

- Purpose:
  List current API keys
- Auth:
  Session
- Returns:
  List of API key metadata for the current user

#### `DELETE /v1/user/me/api-keys/{keyId}`

- Purpose:
  Revoke an API key
- Auth:
  Session
- Returns:
  Success or deletion confirmation

#### `POST /v1/user/me/api-keys/{keyId}/rotate`

- Purpose:
  Rotate the secret key while keeping the same public key
- Auth:
  Session
- Returns:
  Rotated key payload including:
  - `id`
  - `publicKey`
  - `secretKey`
  - `name`
  - `rotatedAt`

### Trading

#### `GET /v1/pm/events`

- Purpose:
  List active or historical prediction-market events
- Auth:
  Public or Read, depending on deployment and filters; docs examples show public and read-key usage
- Query patterns shown in docs:
  - `category`
  - `status`
  - `currency`
  - `page`
  - `size`
  - likely search filters from “Finding markets”
- Returns:
  Event list and pagination
- Example fields shown:
  - event:
    - `id`
    - `title`
    - `category`
    - `status`
    - `markets`
  - market:
    - `id`
    - `question`
    - `outcomes`
    - `engine`
  - `pagination`

#### `GET /v1/pm/events/{eventId}`

- Purpose:
  Retrieve one event by ID
- Auth:
  Read
- Returns:
  One event object including markets and event-level metadata

#### `GET /v1/pm/events/{eventId}/slug`

- Purpose:
  The docs navigation lists “Get event by slug”; exact path should be re-verified before coding
- Auth:
  Read
- Returns:
  Event data resolved from slug

#### `GET /v1/pm/series`

- Purpose:
  The docs navigation lists “List event series”; exact path should be re-verified before coding
- Auth:
  Read
- Returns:
  Series collection

#### `GET /v1/pm/series/{seriesId}/events`

- Purpose:
  The docs navigation lists “Get series events”; exact path should be re-verified before coding
- Auth:
  Read
- Returns:
  Events belonging to one series

#### `POST /v1/pm/events/{eventId}/markets/{marketId}/quote`

- Purpose:
  Price a prospective trade before execution
- Auth:
  Expected to require read/write-capable keying depending on server policy; docs present it as part of trading flow
- Body shown in docs:
  - `side`
  - `outcome`
  - `amount`
  - examples also include `currency`
- Returns:
  Quote payload including:
  - `expectedPrice`
  - `expectedShares`
  - `fee`
  - `total`

#### `POST /v1/pm/events/{eventId}/markets/{marketId}/orders`

- Purpose:
  Place an order
- Auth:
  Write
- Body shown in docs:
  - `side`
  - `outcome`
  - `amount`
  - optionally `price` for CLOB-style limit orders
  - optionally `currency`
- Returns:
  Order payload
- Example fields shown:
  - `id`
  - `eventId`
  - `marketId`
  - `side`
  - `outcomeIndex`
  - `amount`
  - `status`
  - `filledAt`

#### `GET /v1/pm/portfolio`

- Purpose:
  Fetch current positions and portfolio view
- Auth:
  Read
- Returns:
  Portfolio / positions
- Docs conceptually describe position fields such as:
  - shares
  - average price
  - current value
  - unrealized P&L

#### `GET /v1/pm/pnl`

- Purpose:
  Fetch profit-and-loss information
- Auth:
  Read
- Returns:
  Realized / unrealized PnL views

#### `GET /v1/pm/orders`

- Purpose:
  List orders
- Auth:
  Read
- Returns:
  Order collection

#### `GET /v1/pm/orders/{orderId}`

- Purpose:
  Fetch one order by ID
- Auth:
  Read
- Returns:
  One order object

#### `DELETE /v1/pm/orders/{orderId}`

- Purpose:
  Cancel an order
- Auth:
  Write
- Returns:
  Cancellation result / updated order state

#### `POST /v1/pm/markets/{marketId}/mint`

- Purpose:
  Mint a complementary YES/NO pair
- Auth:
  Write
- Returns:
  Mint result / created share quantities

#### `POST /v1/pm/markets/{marketId}/burn`

- Purpose:
  Burn complementary YES/NO pairs back into cash
- Auth:
  Write
- Returns:
  Burn result / redeemed cash amount

#### `GET /v1/pm/activities`

- Purpose:
  Fetch trading and account activity feed
- Auth:
  Read
- Returns:
  Activity history for the current user

### Liquidity Rewards

#### `GET /v1/liquidity-rewards`

- Purpose:
  Fetch liquidity reward configuration or reward history
- Auth:
  Read
- Returns:
  Reward program data

#### `GET /v1/liquidity-rewards/active`

- Purpose:
  Fetch active liquidity reward programs
- Auth:
  Read
- Returns:
  Active reward opportunities

### Wallet

#### `GET /v1/wallet/assets`

- Purpose:
  Fetch wallet asset balances
- Auth:
  Read
- Returns:
  Wallet balances / assets for the current user

### Market Data

#### `GET /v1/pm/events/{eventId}/price-history`

- Purpose:
  Fetch historical prices
- Auth:
  Public or Read depending on deployment
- Query examples:
  - `interval=1h`
- Returns:
  Time-series data for market/event price history

#### `GET /v1/pm/books`

- Purpose:
  Fetch current orderbook data
- Auth:
  Public or Read depending on deployment
- Query examples from docs:
  - `marketId={marketId}`
  - concept docs also imply outcome-oriented reads
- Returns:
  Current bids and asks for CLOB markets

#### `GET /v1/pm/markets/{marketId}/ticker`

- Purpose:
  Fetch real-time market statistics
- Auth:
  Public or Read depending on deployment
- Returns:
  Ticker stats for a market

#### `GET /v1/pm/trades`

- Purpose:
  Fetch recent executed trades
- Auth:
  Public or Read depending on deployment
- Query examples:
  - `marketId={marketId}`
- Returns:
  Recent trade prints for CLOB markets

## PM / Executor Design Implications

### Portfolio Manager

Good Bayse reads for PM:

- `GET /v1/pm/events`
- `GET /v1/pm/books`
- `GET /v1/pm/markets/{marketId}/ticker`
- `GET /v1/pm/trades`
- `POST /quote` for valuation and planning

PM should remain read-only.

### Executor

Bayse writes belong in Executor:

- `POST /orders`
- `DELETE /orders/{orderId}`
- optional `POST /mint`
- optional `POST /burn`

### Researcher

Researcher generally should not use Bayse exchange APIs for truth evaluation.
Truth should come from narrative evidence, not exchange mechanics.

## Current Local Assumptions In This Repo

These are the Bayse-related assumptions currently baked into the codebase:

- PM market discovery uses local text matching because no dedicated server-side semantic market-search endpoint has been wired yet.
- PM valuation prefers quote-style sell simulation over orderbook-only marks.
- PM tools are read-only by design.
- Future Executor tools should carry the signed-write authentication model from the docs.

## Re-Verification Notes

Some endpoint names are clearly listed in the API reference, but a few exact path shapes beyond the visible examples should be re-verified before implementing write-path clients:

- get event by slug
- list event series
- get series events
- liquidity rewards exact route shapes

For everything else in this file, the paths and auth model are directly supported by the Bayse public docs pages cited above.

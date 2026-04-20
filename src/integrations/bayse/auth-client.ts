import { z } from 'zod';

import {
  AppError,
  RateLimitedError,
  UnauthorizedError,
  UpstreamUnavailableError,
} from '../../application/common/errors';

const bayse_session_login_schema = z.object({
  deviceId: z.string().min(1),
  token: z.string().min(1),
  userId: z.string().min(1),
});

const bayse_api_key_metadata_schema = z
  .object({
    createdAt: z.string().optional(),
    id: z.string().min(1),
    name: z.string().min(1),
    publicKey: z.string().min(1),
    rotatedAt: z.string().optional(),
  })
  .passthrough();

const bayse_api_key_record_schema = bayse_api_key_metadata_schema.extend({
  secretKey: z.string().min(1),
});

const bayse_api_key_list_response_schema = z.union([
  z.array(bayse_api_key_metadata_schema),
  z.object({
    apiKeys: z.array(bayse_api_key_metadata_schema),
  }).passthrough(),
  z.object({
    keys: z.array(bayse_api_key_metadata_schema),
  }).passthrough(),
]);

export type BayseApiKeyMetadata = z.infer<
  typeof bayse_api_key_metadata_schema
>;
export type BayseApiKeyRecord = z.infer<typeof bayse_api_key_record_schema>;
export type BayseSessionLogin = z.infer<typeof bayse_session_login_schema>;

export interface BayseAuthClientConfig {
  base_url?: string;
  timeout_ms?: number;
}

export class BayseHttpError extends AppError {
  readonly response_body?: string;
  readonly status: number;
  readonly url: string;

  constructor(params: {
    message: string;
    response_body?: string;
    status: number;
    url: string;
  }) {
    super({
      code:
        params.status === 401 || params.status === 403
          ? 'bayse_unauthorized'
          : 'bayse_http_error',
      details: {
        response_body: params.response_body,
        status: params.status,
        url: params.url,
      },
      message: params.message,
      status_code:
        params.status === 401 || params.status === 403 ? 401 : 502,
    });
    this.name = 'BayseHttpError';
    this.response_body = params.response_body;
    this.status = params.status;
    this.url = params.url;
  }
}

async function fetchJson<T>(params: {
  body?: unknown;
  expect_body?: boolean;
  headers?: Record<string, string>;
  method?: 'DELETE' | 'GET' | 'POST';
  timeout_ms?: number;
  url: string;
}): Promise<T> {
  const response = await fetch(params.url, {
    body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
    headers: {
      ...(params.body !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
      ...params.headers,
    },
    method: params.method ?? 'GET',
    signal: AbortSignal.timeout(params.timeout_ms ?? 15_000),
  });

  if (!response.ok) {
    const response_body = await response.text().catch(() => undefined);

    throw new BayseHttpError({
      message: `Bayse API request failed with status ${response.status}.`,
      response_body,
      status: response.status,
      url: params.url,
    });
  }

  if (params.expect_body === false || response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function normalizeApiKeyListResponse(
  response: z.infer<typeof bayse_api_key_list_response_schema>,
): BayseApiKeyMetadata[] {
  if (Array.isArray(response)) {
    return response;
  }

  if ('apiKeys' in response && Array.isArray(response.apiKeys)) {
    return response.apiKeys;
  }

  if ('keys' in response && Array.isArray(response.keys)) {
    return response.keys;
  }

  return [];
}

export class BayseAuthClient {
  private readonly base_url: string;
  private readonly timeout_ms: number;

  constructor(config: BayseAuthClientConfig = {}) {
    this.base_url = config.base_url ?? 'https://relay.bayse.markets';
    this.timeout_ms = config.timeout_ms ?? 15_000;
  }

  private buildUrl(path: string) {
    return `${this.base_url.replace(/\/$/, '')}${path}`;
  }

  private getSessionHeaders(params: {
    device_id: string;
    token: string;
  }) {
    return {
      'x-auth-token': params.token,
      'x-device-id': params.device_id,
    };
  }

  async createApiKey(input: {
    device_id: string;
    name: string;
    token: string;
  }): Promise<BayseApiKeyRecord> {
    const response = await fetchJson<unknown>({
      body: {
        name: input.name,
      },
      headers: this.getSessionHeaders({
        device_id: input.device_id,
        token: input.token,
      }),
      method: 'POST',
      timeout_ms: this.timeout_ms,
      url: this.buildUrl('/v1/user/me/api-keys'),
    });

    return bayse_api_key_record_schema.parse(response);
  }

  async listApiKeys(input: {
    device_id: string;
    token: string;
  }): Promise<BayseApiKeyMetadata[]> {
    const response = await fetchJson<unknown>({
      headers: this.getSessionHeaders({
        device_id: input.device_id,
        token: input.token,
      }),
      method: 'GET',
      timeout_ms: this.timeout_ms,
      url: this.buildUrl('/v1/user/me/api-keys'),
    });

    return normalizeApiKeyListResponse(
      bayse_api_key_list_response_schema.parse(response),
    );
  }

  async login(input: {
    email: string;
    password: string;
  }): Promise<BayseSessionLogin> {
    try {
      const response = await fetchJson<unknown>({
        body: {
          email: input.email,
          password: input.password,
        },
        method: 'POST',
        timeout_ms: this.timeout_ms,
        url: this.buildUrl('/v1/user/login'),
      });

      return bayse_session_login_schema.parse(response);
    } catch (error) {
      if (error instanceof BayseHttpError && error.status === 401) {
        throw new UnauthorizedError(
          'Bayse rejected the provided credentials.',
          {
            response_body: error.response_body,
          },
        );
      }

      if (error instanceof BayseHttpError && error.status === 429) {
        throw new RateLimitedError({
          message: 'Bayse login is rate-limited. Try again shortly.',
          retry_after_seconds: 120,
        });
      }

      if (error instanceof BayseHttpError && error.status >= 500) {
        throw new UpstreamUnavailableError(
          'Bayse is temporarily unavailable. Try again shortly.',
          { response_body: error.response_body, status: error.status },
        );
      }

      throw error;
    }
  }

  async deleteApiKey(input: {
    device_id: string;
    key_id: string;
    token: string;
  }): Promise<void> {
    await fetchJson<unknown>({
      expect_body: false,
      headers: this.getSessionHeaders({
        device_id: input.device_id,
        token: input.token,
      }),
      method: 'DELETE',
      timeout_ms: this.timeout_ms,
      url: this.buildUrl(
        `/v1/user/me/api-keys/${encodeURIComponent(input.key_id)}`,
      ),
    });
  }

  async rotateApiKey(input: {
    device_id: string;
    key_id: string;
    token: string;
  }): Promise<BayseApiKeyRecord> {
    const response = await fetchJson<unknown>({
      headers: this.getSessionHeaders({
        device_id: input.device_id,
        token: input.token,
      }),
      method: 'POST',
      timeout_ms: this.timeout_ms,
      url: this.buildUrl(
        `/v1/user/me/api-keys/${encodeURIComponent(input.key_id)}/rotate`,
      ),
    });

    return bayse_api_key_record_schema.parse(response);
  }
}

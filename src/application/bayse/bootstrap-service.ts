import type { Logger } from 'pino';

import {
  type BayseConnectionStore,
  type StoredBayseApiKey,
  type StoredBayseConnection,
} from './credentials-service';
import {
  NotFoundError,
  RateLimitedError,
} from '../common/errors';
import {
  type BayseApiKeyMetadata,
  type BayseApiKeyRecord,
  type BayseAuthClient,
  type BayseSessionLogin,
} from '../../integrations/bayse/auth-client';
import type { RateLimitStore } from '../../infrastructure/redis/rate-limit-store';

export interface BayseConnectionSummary {
  api_key?: {
    created_at?: string;
    key_id: string;
    name: string;
    public_key_preview: string;
    rotated_at?: string;
  };
  bayse_user_id: string;
  connected_at: string;
  email: string;
  owner_id: string;
}

export interface BayseBootstrapServiceParams {
  auth_client: Pick<
    BayseAuthClient,
    | 'createApiKey'
    | 'deleteApiKey'
    | 'getWalletAssets'
    | 'listApiKeys'
    | 'login'
    | 'rotateApiKey'
  >;
  connection_store: BayseConnectionStore;
  logger: Logger;
  login_rate_limit_seconds: number;
  rate_limit_store: RateLimitStore;
}

function maskPublicKey(public_key: string) {
  if (public_key.length <= 10) {
    return public_key;
  }

  return `${public_key.slice(0, 7)}...${public_key.slice(-4)}`;
}

function toStoredApiKey(record: BayseApiKeyRecord): StoredBayseApiKey {
  return {
    created_at: record.createdAt,
    key_id: record.id,
    name: record.name,
    public_key: record.publicKey,
    rotated_at: record.rotatedAt,
    secret_key: record.secretKey,
  };
}

function toSummary(connection: StoredBayseConnection): BayseConnectionSummary {
  return {
    ...(connection.latest_api_key
      ? {
          api_key: {
            created_at: connection.latest_api_key.created_at,
            key_id: connection.latest_api_key.key_id,
            name: connection.latest_api_key.name,
            public_key_preview: maskPublicKey(
              connection.latest_api_key.public_key,
            ),
            rotated_at: connection.latest_api_key.rotated_at,
          },
        }
      : {}),
    bayse_user_id: connection.session.bayse_user_id,
    connected_at: connection.session.connected_at,
    email: connection.session.email,
    owner_id: connection.owner_id,
  };
}

function requireConnection(
  connection: StoredBayseConnection | null,
  owner_id: string,
) {
  if (!connection) {
    throw new NotFoundError(
      `No Bayse connection found for owner "${owner_id}". Connect Bayse first.`,
    );
  }

  return connection;
}

export class BayseBootstrapService {
  private readonly auth_client: BayseBootstrapServiceParams['auth_client'];
  private readonly connection_store: BayseConnectionStore;
  private readonly logger: Logger;
  private readonly login_rate_limit_seconds: number;
  private readonly rate_limit_store: RateLimitStore;

  constructor(params: BayseBootstrapServiceParams) {
    this.auth_client = params.auth_client;
    this.connection_store = params.connection_store;
    this.logger = params.logger;
    this.login_rate_limit_seconds = params.login_rate_limit_seconds;
    this.rate_limit_store = params.rate_limit_store;
  }

  async connectAccount(input: {
    email: string;
    owner_id: string;
    password: string;
  }) {
    if (this.login_rate_limit_seconds > 0) {
      const slot = await this.rate_limit_store.acquireSlot({
        key: `bayse:login:${input.email.toLowerCase()}`,
        window_seconds: this.login_rate_limit_seconds,
      });

      if (!slot.allowed) {
        throw new RateLimitedError({
          message:
            'Bayse login is rate-limited to prevent upstream throttling. Try again shortly.',
          retry_after_seconds: slot.remaining_seconds,
        });
      }
    }

    const login: BayseSessionLogin = await this.auth_client.login({
      email: input.email,
      password: input.password,
    });

    const connection = await this.connection_store.saveSession({
      owner_id: input.owner_id,
      session: {
        bayse_user_id: login.userId,
        connected_at: new Date().toISOString(),
        device_id: login.deviceId,
        email: input.email,
        token: login.token,
      },
    });

    this.logger.info(
      { owner_id: input.owner_id, bayse_user_id: login.userId },
      'bayse session connected',
    );

    return toSummary(connection);
  }

  async createApiKey(input: {
    name: string;
    owner_id: string;
  }) {
    const connection = requireConnection(
      await this.connection_store.getConnection(input.owner_id),
      input.owner_id,
    );

    const key_record = await this.auth_client.createApiKey({
      device_id: connection.session.device_id,
      name: input.name,
      token: connection.session.token,
    });

    const updated_connection = await this.connection_store.saveApiKey({
      api_key: toStoredApiKey(key_record),
      owner_id: input.owner_id,
    });

    this.logger.info(
      { owner_id: input.owner_id, key_id: key_record.id },
      'bayse api key created',
    );

    return toSummary(updated_connection);
  }

  async deleteApiKey(input: { key_id: string; owner_id: string }) {
    const connection = requireConnection(
      await this.connection_store.getConnection(input.owner_id),
      input.owner_id,
    );

    await this.auth_client.deleteApiKey({
      device_id: connection.session.device_id,
      key_id: input.key_id,
      token: connection.session.token,
    });

    this.logger.info(
      { owner_id: input.owner_id, key_id: input.key_id },
      'bayse api key deleted',
    );

    return {
      key_id: input.key_id,
      owner_id: input.owner_id,
    };
  }

  async getConnectionStatus(owner_id: string) {
    const connection = requireConnection(
      await this.connection_store.getConnection(owner_id),
      owner_id,
    );

    return toSummary(connection);
  }

  async getWalletBalance(owner_id: string) {
    const connection = requireConnection(
      await this.connection_store.getConnection(owner_id),
      owner_id,
    );

    const assets = await this.auth_client.getWalletAssets({
      device_id: connection.session.device_id,
      token: connection.session.token,
    });

    return {
      assets,
      fetched_at: new Date().toISOString(),
      owner_id,
    };
  }

  async listApiKeys(owner_id: string) {
    const connection = requireConnection(
      await this.connection_store.getConnection(owner_id),
      owner_id,
    );

    const api_keys: BayseApiKeyMetadata[] = await this.auth_client.listApiKeys({
      device_id: connection.session.device_id,
      token: connection.session.token,
    });

    return {
      keys: api_keys.map((key) => ({
        created_at: key.createdAt,
        key_id: key.id,
        name: key.name,
        public_key_preview: maskPublicKey(key.publicKey),
        rotated_at: key.rotatedAt,
      })),
      owner_id,
    };
  }

  async rotateApiKey(input: {
    key_id: string;
    owner_id: string;
  }) {
    const connection = requireConnection(
      await this.connection_store.getConnection(input.owner_id),
      input.owner_id,
    );

    const rotated_key = await this.auth_client.rotateApiKey({
      device_id: connection.session.device_id,
      key_id: input.key_id,
      token: connection.session.token,
    });

    const updated_connection = await this.connection_store.saveApiKey({
      api_key: toStoredApiKey(rotated_key),
      owner_id: input.owner_id,
    });

    this.logger.info(
      { owner_id: input.owner_id, key_id: input.key_id },
      'bayse api key rotated',
    );

    return toSummary(updated_connection);
  }
}

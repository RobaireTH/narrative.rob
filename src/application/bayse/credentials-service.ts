import { NotFoundError } from '../common/errors';

export interface StoredBayseSession {
  bayse_user_id: string;
  connected_at: string;
  device_id: string;
  email: string;
  token: string;
}

export interface StoredBayseApiKey {
  created_at?: string;
  key_id: string;
  name: string;
  public_key: string;
  rotated_at?: string;
  secret_key: string;
}

export interface StoredBayseConnection {
  created_at: string;
  latest_api_key?: StoredBayseApiKey;
  owner_id: string;
  session: StoredBayseSession;
  updated_at: string;
}

export interface BayseConnectionStore {
  getConnection(owner_id: string): Promise<StoredBayseConnection | null>;
  saveApiKey(params: {
    api_key: StoredBayseApiKey;
    owner_id: string;
  }): Promise<StoredBayseConnection>;
  saveSession(params: {
    owner_id: string;
    session: StoredBayseSession;
  }): Promise<StoredBayseConnection>;
}

function cloneConnection(connection: StoredBayseConnection) {
  return {
    ...connection,
    ...(connection.latest_api_key
      ? {
          latest_api_key: {
            ...connection.latest_api_key,
          },
        }
      : {}),
    session: {
      ...connection.session,
    },
  };
}

export class InMemoryBayseConnectionStore implements BayseConnectionStore {
  private readonly connections = new Map<string, StoredBayseConnection>();

  async getConnection(owner_id: string): Promise<StoredBayseConnection | null> {
    const connection = this.connections.get(owner_id);
    return connection ? cloneConnection(connection) : null;
  }

  async saveApiKey(params: {
    api_key: StoredBayseApiKey;
    owner_id: string;
  }): Promise<StoredBayseConnection> {
    const existing = this.connections.get(params.owner_id);

    if (!existing) {
      throw new NotFoundError(
        `No Bayse session exists for owner "${params.owner_id}". Connect the account first.`,
      );
    }

    const updated: StoredBayseConnection = {
      ...existing,
      latest_api_key: params.api_key,
      updated_at: new Date().toISOString(),
    };
    this.connections.set(params.owner_id, updated);
    return cloneConnection(updated);
  }

  async saveSession(params: {
    owner_id: string;
    session: StoredBayseSession;
  }): Promise<StoredBayseConnection> {
    const existing = this.connections.get(params.owner_id);
    const now = new Date().toISOString();

    const connection: StoredBayseConnection = {
      created_at: existing?.created_at ?? now,
      latest_api_key: existing?.latest_api_key,
      owner_id: params.owner_id,
      session: params.session,
      updated_at: now,
    };

    this.connections.set(params.owner_id, connection);
    return cloneConnection(connection);
  }
}

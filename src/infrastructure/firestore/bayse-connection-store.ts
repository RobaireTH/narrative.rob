import type { Firestore } from '@google-cloud/firestore';

import type {
  BayseConnectionStore,
  StoredBayseApiKey,
  StoredBayseConnection,
  StoredBayseSession,
} from '../../application/bayse/credentials-service';
import { NotFoundError } from '../../application/common/errors';
import {
  GoogleSecretManagerStore,
} from '../secrets/secret-manager';

interface FirestoreBayseConnectionDoc {
  created_at: string;
  latest_api_key_meta?: {
    created_at?: string;
    key_id: string;
    name: string;
    public_key: string;
    rotated_at?: string;
  };
  latest_api_key_secret_name?: string;
  owner_id: string;
  session_meta: {
    bayse_user_id: string;
    connected_at: string;
    email: string;
  };
  session_secret_name: string;
  updated_at: string;
}

export interface FirestoreBayseConnectionStoreParams {
  api_key_secret_prefix: string;
  collection_name?: string;
  firestore: Firestore;
  secret_manager: GoogleSecretManagerStore;
  session_secret_prefix: string;
}

export class FirestoreBayseConnectionStore implements BayseConnectionStore {
  private readonly api_key_secret_prefix: string;
  private readonly collection_name: string;
  private readonly firestore: Firestore;
  private readonly secret_manager: GoogleSecretManagerStore;
  private readonly session_secret_prefix: string;

  constructor(params: FirestoreBayseConnectionStoreParams) {
    this.api_key_secret_prefix = params.api_key_secret_prefix;
    this.collection_name = params.collection_name ?? 'bayse_accounts';
    this.firestore = params.firestore;
    this.secret_manager = params.secret_manager;
    this.session_secret_prefix = params.session_secret_prefix;
  }

  private collection() {
    return this.firestore.collection(this.collection_name);
  }

  private apiKeySecretId(owner_id: string) {
    return `${this.api_key_secret_prefix}-${owner_id}`;
  }

  private async expandConnection(
    doc: FirestoreBayseConnectionDoc,
  ): Promise<StoredBayseConnection> {
    const session = await this.secret_manager.accessJsonSecret<StoredBayseSession>(
      doc.session_secret_name,
    );
    const latest_api_key =
      doc.latest_api_key_secret_name !== undefined
        ? await this.secret_manager.accessJsonSecret<StoredBayseApiKey>(
            doc.latest_api_key_secret_name,
          )
        : undefined;

    return {
      created_at: doc.created_at,
      latest_api_key,
      owner_id: doc.owner_id,
      session,
      updated_at: doc.updated_at,
    };
  }

  private async getDoc(owner_id: string) {
    const snapshot = await this.collection().doc(owner_id).get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as FirestoreBayseConnectionDoc;
  }

  private sessionSecretId(owner_id: string) {
    return `${this.session_secret_prefix}-${owner_id}`;
  }

  async getConnection(owner_id: string): Promise<StoredBayseConnection | null> {
    const doc = await this.getDoc(owner_id);
    if (!doc) {
      return null;
    }

    return this.expandConnection(doc);
  }

  async saveApiKey(params: {
    api_key: StoredBayseApiKey;
    owner_id: string;
  }): Promise<StoredBayseConnection> {
    const existing = await this.getDoc(params.owner_id);

    if (!existing) {
      throw new NotFoundError(
        `No Bayse session exists for owner "${params.owner_id}". Connect the account first.`,
      );
    }

    const secret_name = await this.secret_manager.addJsonSecretVersion({
      secret_id: this.apiKeySecretId(params.owner_id),
      value: params.api_key,
    });
    const updated_at = new Date().toISOString();

    const doc: FirestoreBayseConnectionDoc = {
      ...existing,
      latest_api_key_meta: {
        created_at: params.api_key.created_at,
        key_id: params.api_key.key_id,
        name: params.api_key.name,
        public_key: params.api_key.public_key,
        rotated_at: params.api_key.rotated_at,
      },
      latest_api_key_secret_name: secret_name,
      updated_at,
    };

    await this.collection().doc(params.owner_id).set(doc, {
      merge: true,
    });

    return this.expandConnection(doc);
  }

  async saveSession(params: {
    owner_id: string;
    session: StoredBayseSession;
  }): Promise<StoredBayseConnection> {
    const existing = await this.getDoc(params.owner_id);
    const secret_name = await this.secret_manager.addJsonSecretVersion({
      secret_id: this.sessionSecretId(params.owner_id),
      value: params.session,
    });
    const now = new Date().toISOString();

    const doc: FirestoreBayseConnectionDoc = {
      created_at: existing?.created_at ?? now,
      ...(existing?.latest_api_key_meta
        ? {
            latest_api_key_meta: existing.latest_api_key_meta,
          }
        : {}),
      ...(existing?.latest_api_key_secret_name
        ? {
            latest_api_key_secret_name: existing.latest_api_key_secret_name,
          }
        : {}),
      owner_id: params.owner_id,
      session_meta: {
        bayse_user_id: params.session.bayse_user_id,
        connected_at: params.session.connected_at,
        email: params.session.email,
      },
      session_secret_name: secret_name,
      updated_at: now,
    };

    await this.collection().doc(params.owner_id).set(doc, {
      merge: true,
    });

    return this.expandConnection(doc);
  }
}

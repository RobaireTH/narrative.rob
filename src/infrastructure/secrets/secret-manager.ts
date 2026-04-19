import {
  SecretManagerServiceClient,
} from '@google-cloud/secret-manager';

export interface SecretManagerConfig {
  project_id: string;
}

function toSecretResourceName(params: {
  project_id: string;
  secret_id: string;
}) {
  return `projects/${params.project_id}/secrets/${params.secret_id}`;
}

function sanitizeSecretId(secret_id: string) {
  return secret_id.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

export class GoogleSecretManagerStore {
  private readonly client: SecretManagerServiceClient;
  private readonly project_id: string;

  constructor(config: SecretManagerConfig) {
    this.client = new SecretManagerServiceClient();
    this.project_id = config.project_id;
  }

  async accessJsonSecret<T>(secret_name: string): Promise<T> {
    const [version] = await this.client.accessSecretVersion({
      name: `${secret_name}/versions/latest`,
    });

    const payload = version.payload?.data?.toString('utf8');
    if (!payload) {
      throw new Error(`Secret "${secret_name}" has no payload.`);
    }

    return JSON.parse(payload) as T;
  }

  async addJsonSecretVersion(params: {
    secret_id: string;
    value: unknown;
  }) {
    const sanitized_secret_id = sanitizeSecretId(params.secret_id);
    const secret_name = toSecretResourceName({
      project_id: this.project_id,
      secret_id: sanitized_secret_id,
    });

    try {
      await this.client.createSecret({
        parent: `projects/${this.project_id}`,
        secret: {
          replication: {
            automatic: {},
          },
        },
        secretId: sanitized_secret_id,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      if (!message.includes('Already exists')) {
        throw error;
      }
    }

    await this.client.addSecretVersion({
      parent: secret_name,
      payload: {
        data: Buffer.from(JSON.stringify(params.value)),
      },
    });

    return secret_name;
  }
}

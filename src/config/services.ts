import type { Logger } from 'pino';

import type { AuthService } from '../application/auth/service';
import {
  DisabledAuthService,
} from '../application/auth/service';
import type { AppEnv } from './env';
import {
  BayseBootstrapService,
} from '../application/bayse/bootstrap-service';
import {
  InMemoryBayseConnectionStore,
} from '../application/bayse/credentials-service';
import {
  CompilerService,
} from '../application/compiler/service';
import {
  InMemoryCompilerThreadStore,
} from '../application/compiler/thread-store';
import {
  BayseAuthClient,
} from '../integrations/bayse/auth-client';
import { createFirestoreClient } from '../infrastructure/firestore/client';
import {
  FirestoreBayseConnectionStore,
} from '../infrastructure/firestore/bayse-connection-store';
import {
  FirestoreCompilerThreadStore,
} from '../infrastructure/firestore/compiler-thread-store';
import {
  GoogleSecretManagerStore,
} from '../infrastructure/secrets/secret-manager';
import {
  createGoogleCloudStorageClient,
} from '../infrastructure/gcs/client';
import {
  GoogleCloudWorkspaceArtifactStore,
} from '../infrastructure/gcs/workspace-artifact-store';
import {
  InMemoryWorkspaceArtifactStore,
} from '../application/workspaces/artifact-store';
import {
  InMemoryNarrativeStore,
} from '../application/narratives/store';
import {
  NarrativeService,
} from '../application/narratives/service';
import {
  FirestoreNarrativeStore,
} from '../infrastructure/firestore/narrative-store';
import {
  InMemoryWorkspaceStore,
} from '../application/workspaces/store';
import {
  FirestoreWorkspaceStore,
} from '../infrastructure/firestore/workspace-store';
import {
  InMemoryOrchestratorScheduleStore,
} from '../application/orchestrator/schedule-store';
import {
  FirestoreOrchestratorScheduleStore,
} from '../infrastructure/firestore/orchestrator-schedule-store';
import {
  InMemoryOrchestratorRunStore,
} from '../application/orchestrator/run-store';
import {
  FirestoreOrchestratorRunStore,
} from '../infrastructure/firestore/orchestrator-run-store';
import {
  OrchestratorService,
} from '../application/orchestrator/service';
import {
  DeepAgentsOrchestratorRuntime,
  type OrchestratorRuntime,
} from '../application/orchestrator/runtime';
import {
  PortfolioService,
} from '../application/portfolio/service';
import {
  WorkspaceBootstrapService,
} from '../application/workspaces/service';
import {
  FirebaseAdminAuthService,
} from '../integrations/firebase/admin-auth';
import {
  TradingPolicyService,
} from '../application/trading-policy/service';
import {
  createRedisClient,
  type RedisClient,
} from '../infrastructure/redis/client';
import {
  InMemoryLockStore,
  RedisLockStore,
  type LockStore,
} from '../infrastructure/redis/lock-store';
import {
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
} from '../infrastructure/redis/rate-limit-store';
import {
  CloudTasksOrchestratorClient,
  InMemoryOrchestratorTaskClient,
  type OrchestratorTaskClient,
} from '../infrastructure/tasks/cloud-tasks';

export interface AppServices {
  auth_service: AuthService;
  bayse_bootstrap_service: BayseBootstrapService;
  compiler_service: CompilerService;
  lock_store: LockStore;
  narrative_service: NarrativeService;
  orchestrator_service: OrchestratorService;
  portfolio_service: PortfolioService;
  rate_limit_store: RateLimitStore;
  redis_client?: RedisClient;
  trading_policy_service: TradingPolicyService;
  workspace_bootstrap_service: WorkspaceBootstrapService;
}

export interface CreateServicesParams {
  env: AppEnv;
  logger: Logger;
}

export function createServices(params: CreateServicesParams): AppServices {
  const { env, logger } = params;

  const requireGcpProject = () => {
    if (!env.GOOGLE_CLOUD_PROJECT) {
      throw new Error(
        'GOOGLE_CLOUD_PROJECT is required when APP_STORAGE_MODE=gcp.',
      );
    }

    return env.GOOGLE_CLOUD_PROJECT;
  };

  const shared_firestore =
    env.APP_STORAGE_MODE === 'gcp'
      ? createFirestoreClient({
          database_id: env.FIRESTORE_DATABASE_ID,
          project_id: requireGcpProject(),
        })
      : undefined;

  const redis_client = env.REDIS_URL
    ? createRedisClient({ url: env.REDIS_URL })
    : undefined;

  if (redis_client) {
    redis_client.on('error', (error) => {
      logger.error({ err: error }, 'redis client error');
    });
    redis_client.on('connect', () => {
      logger.info('redis client connected');
    });
  }

  const lock_store: LockStore = redis_client
    ? new RedisLockStore(redis_client)
    : new InMemoryLockStore();
  const rate_limit_store: RateLimitStore = redis_client
    ? new RedisRateLimitStore(redis_client)
    : new InMemoryRateLimitStore();

  const bayse_auth_client = new BayseAuthClient({
    base_url: env.BAYSE_BASE_URL,
    timeout_ms: env.BAYSE_TIMEOUT_MS,
  });
  const auth_service: AuthService =
    env.AUTH_PROVIDER === 'firebase'
      ? new FirebaseAdminAuthService({
          client_email: env.FIREBASE_CLIENT_EMAIL,
          private_key: env.FIREBASE_PRIVATE_KEY,
          project_id: env.FIREBASE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT,
        })
      : new DisabledAuthService();
  const trading_policy_service = new TradingPolicyService({
    default_mode: env.TRADING_MODE_DEFAULT,
    enable_live_trading: env.ENABLE_LIVE_TRADING,
    enable_paper_trading: env.ENABLE_PAPER_TRADING,
  });

  const bayse_connection_store =
    env.APP_STORAGE_MODE === 'gcp'
      ? (() => {
          const project_id = requireGcpProject();
          const secret_manager = new GoogleSecretManagerStore({
            project_id,
          });

          return new FirestoreBayseConnectionStore({
            api_key_secret_prefix:
              env.SECRET_MANAGER_BAYSE_API_KEY_PREFIX,
            collection_name:
              env.FIRESTORE_BAYSE_CONNECTIONS_COLLECTION,
            firestore: shared_firestore!,
            secret_manager,
            session_secret_prefix:
              env.SECRET_MANAGER_BAYSE_SESSION_PREFIX,
          });
        })()
      : new InMemoryBayseConnectionStore();

  const compiler_thread_store =
    env.APP_STORAGE_MODE === 'gcp'
      ? new FirestoreCompilerThreadStore({
          collection_name: env.FIRESTORE_COMPILER_THREADS_COLLECTION,
          firestore: shared_firestore!,
        })
      : new InMemoryCompilerThreadStore();

  const narrative_store =
    env.APP_STORAGE_MODE === 'gcp'
      ? new FirestoreNarrativeStore({
          collection_name: env.FIRESTORE_NARRATIVES_COLLECTION,
          firestore: shared_firestore!,
        })
      : new InMemoryNarrativeStore();

  const workspace_store =
    env.APP_STORAGE_MODE === 'gcp'
      ? new FirestoreWorkspaceStore({
          collection_name: env.FIRESTORE_WORKSPACES_COLLECTION,
          firestore: shared_firestore!,
        })
      : new InMemoryWorkspaceStore();

  const artifact_store =
    env.APP_STORAGE_MODE === 'gcp'
      ? (() => {
          if (!env.GCS_WORKSPACE_BUCKET) {
            throw new Error(
              'GCS_WORKSPACE_BUCKET is required when APP_STORAGE_MODE=gcp.',
            );
          }

          return new GoogleCloudWorkspaceArtifactStore({
            bucket_name: env.GCS_WORKSPACE_BUCKET,
            storage: createGoogleCloudStorageClient({
              project_id: requireGcpProject(),
            }),
          });
        })()
      : new InMemoryWorkspaceArtifactStore();

  const orchestrator_schedule_store =
    env.APP_STORAGE_MODE === 'gcp'
      ? new FirestoreOrchestratorScheduleStore({
          collection_name:
            env.FIRESTORE_ORCHESTRATOR_SCHEDULES_COLLECTION,
          firestore: shared_firestore!,
        })
      : new InMemoryOrchestratorScheduleStore();

  const orchestrator_run_store =
    env.APP_STORAGE_MODE === 'gcp'
      ? new FirestoreOrchestratorRunStore({
          collection_name: env.FIRESTORE_ORCHESTRATOR_RUNS_COLLECTION,
          firestore: shared_firestore!,
        })
      : new InMemoryOrchestratorRunStore();

  const cloud_tasks_configured = Boolean(
    env.CLOUD_TASKS_LOCATION &&
      env.CLOUD_TASKS_ORCHESTRATOR_QUEUE &&
      env.CLOUD_TASKS_ORCHESTRATOR_URL &&
      env.CLOUD_TASKS_SERVICE_ACCOUNT &&
      env.GOOGLE_CLOUD_PROJECT,
  );

  const task_client: OrchestratorTaskClient = cloud_tasks_configured
    ? new CloudTasksOrchestratorClient({
        handler_url: env.CLOUD_TASKS_ORCHESTRATOR_URL!,
        location: env.CLOUD_TASKS_LOCATION!,
        logger,
        project_id: env.GOOGLE_CLOUD_PROJECT!,
        queue_name: env.CLOUD_TASKS_ORCHESTRATOR_QUEUE!,
        service_account_email: env.CLOUD_TASKS_SERVICE_ACCOUNT!,
      })
    : new InMemoryOrchestratorTaskClient(logger);

  const orchestrator_runtime: OrchestratorRuntime | undefined =
    env.ORCHESTRATOR_RUNTIME_MODE === 'deepagents'
      ? (() => {
          if (!env.ANTHROPIC_API_KEY) {
            throw new Error(
              'ANTHROPIC_API_KEY is required when ORCHESTRATOR_RUNTIME_MODE=deepagents.',
            );
          }
          return new DeepAgentsOrchestratorRuntime({
            anthropic_api_key: env.ANTHROPIC_API_KEY,
            artifact_store,
            bayse_base_url: env.BAYSE_BASE_URL,
            bayse_public_key: process.env.BAYSE_PUBLIC_KEY?.trim(),
            bayse_secret_key: process.env.BAYSE_SECRET_KEY?.trim(),
            bayse_timeout_ms: env.BAYSE_TIMEOUT_MS,
            executor_model_id:
              process.env.ORCHESTRATOR_EXECUTOR_MODEL_ID ??
              'claude-haiku-4-5-20251001',
            logger,
            pm_model_id:
              process.env.ORCHESTRATOR_PM_MODEL_ID ??
              'claude-haiku-4-5-20251001',
            researcher_model_id:
              process.env.ORCHESTRATOR_RESEARCHER_MODEL_ID ??
              'claude-sonnet-4-6',
            supervisor_model_id:
              process.env.ORCHESTRATOR_SUPERVISOR_MODEL_ID ??
              'claude-sonnet-4-6',
            workspace_store,
          });
        })()
      : undefined;

  const orchestrator_service = new OrchestratorService({
    artifact_store,
    lock_store,
    lock_ttl_seconds: env.ORCHESTRATOR_LOCK_TTL_SECONDS,
    logger,
    run_store: orchestrator_run_store,
    runtime: orchestrator_runtime,
    runtime_mode: env.ORCHESTRATOR_RUNTIME_MODE,
    schedule_store: orchestrator_schedule_store,
    task_client,
    trading_policy_service,
    workspace_store,
  });

  return {
    auth_service,
    bayse_bootstrap_service: new BayseBootstrapService({
      auth_client: bayse_auth_client,
      connection_store: bayse_connection_store,
      logger,
      login_rate_limit_seconds: env.BAYSE_LOGIN_RATE_LIMIT_SECONDS,
      rate_limit_store,
    }),
    compiler_service: new CompilerService({
      anthropic_api_key: env.ANTHROPIC_API_KEY,
      logger,
      model_id: env.COMPILER_MODEL_ID,
      narrative_store,
      redis_ttl_minutes: env.COMPILER_REDIS_TTL_MINUTES,
      redis_url: env.REDIS_URL,
      runtime_mode: env.COMPILER_RUNTIME_MODE,
      thread_store: compiler_thread_store,
    }),
    lock_store,
    narrative_service: new NarrativeService({
      narrative_store,
    }),
    orchestrator_service,
    portfolio_service: new PortfolioService({
      artifact_store,
      logger,
      workspace_store,
    }),
    rate_limit_store,
    redis_client,
    trading_policy_service,
    workspace_bootstrap_service: new WorkspaceBootstrapService({
      artifact_object_prefix: env.GCS_WORKSPACE_PREFIX,
      artifact_store,
      logger,
      narrative_store,
      orchestrator_service,
      workspace_store,
    }),
  };
}

export async function shutdownServices(services: AppServices): Promise<void> {
  if (services.redis_client) {
    await services.redis_client.quit().catch(() => undefined);
  }
}

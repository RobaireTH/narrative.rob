import { z } from 'zod';

const cors_origins_schema = z
  .string()
  .optional()
  .transform((value) => {
    if (!value) return [] as string[];
    return value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  });

const env_schema = z
  .object({
    ALLOW_NARRATIVE_IMPORT: z.coerce.boolean().default(false),
    ANTHROPIC_API_KEY: z.string().optional(),
    APP_STORAGE_MODE: z.enum(['gcp', 'memory']).default('memory'),
    AUTH_PROVIDER: z.enum(['disabled', 'firebase']).default('disabled'),
    BAYSE_BASE_URL: z.string().url().default('https://relay.bayse.markets'),
    BAYSE_LOGIN_RATE_LIMIT_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(120),
    BAYSE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    CLOUD_TASKS_LOCATION: z.string().optional(),
    CLOUD_TASKS_ORCHESTRATOR_QUEUE: z.string().optional(),
    CLOUD_TASKS_ORCHESTRATOR_URL: z.string().url().optional(),
    CLOUD_TASKS_SERVICE_ACCOUNT: z.string().optional(),
    COMPILER_MODEL_ID: z.string().default('claude-opus-4-7'),
    COMPILER_REDIS_TTL_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 48),
    COMPILER_RUNTIME_MODE: z
      .enum(['disabled', 'langgraph'])
      .default('disabled'),
    CORS_ALLOWED_ORIGINS: cors_origins_schema,
    ENABLE_LIVE_TRADING: z.coerce.boolean().default(false),
    ENABLE_PAPER_TRADING: z.coerce.boolean().default(true),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIRESTORE_BAYSE_CONNECTIONS_COLLECTION: z
      .string()
      .default('bayse_accounts'),
    FIRESTORE_COMPILER_THREADS_COLLECTION: z
      .string()
      .default('compiler_threads'),
    FIRESTORE_DATABASE_ID: z.string().optional(),
    FIRESTORE_NARRATIVES_COLLECTION: z.string().default('narratives'),
    FIRESTORE_ORCHESTRATOR_RUNS_COLLECTION: z
      .string()
      .default('orchestrator_runs'),
    FIRESTORE_ORCHESTRATOR_SCHEDULES_COLLECTION: z
      .string()
      .default('orchestrator_schedules'),
    FIRESTORE_WORKSPACES_COLLECTION: z.string().default('workspaces'),
    GCS_WORKSPACE_BUCKET: z.string().optional(),
    GCS_WORKSPACE_PREFIX: z.string().default('workspaces'),
    GOOGLE_CLOUD_PROJECT: z.string().optional(),
    HOST: z.string().default('127.0.0.1'),
    INTERNAL_TOKEN: z.string().optional(),
    LOG_LEVEL: z
      .enum(['debug', 'error', 'fatal', 'info', 'silent', 'trace', 'warn'])
      .optional(),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    ORCHESTRATOR_LOCK_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    ORCHESTRATOR_RUNTIME_MODE: z
      .enum(['deepagents', 'disabled'])
      .default('disabled'),
    PORT: z.coerce.number().int().positive().default(3000),
    REDIS_URL: z.string().optional(),
    SECRET_MANAGER_BAYSE_API_KEY_PREFIX: z
      .string()
      .default('narrative-bayse-api-key'),
    SECRET_MANAGER_BAYSE_SESSION_PREFIX: z
      .string()
      .default('narrative-bayse-session'),
    TRADING_MODE_DEFAULT: z.enum(['live', 'paper']).default('paper'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.AUTH_PROVIDER === 'disabled') {
      ctx.addIssue({
        code: 'custom',
        message:
          'AUTH_PROVIDER=disabled is not allowed when NODE_ENV=production.',
        path: ['AUTH_PROVIDER'],
      });
    }

    if (
      value.COMPILER_RUNTIME_MODE === 'langgraph' &&
      !value.ANTHROPIC_API_KEY
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'ANTHROPIC_API_KEY is required when COMPILER_RUNTIME_MODE=langgraph.',
        path: ['ANTHROPIC_API_KEY'],
      });
    }

    if (
      value.COMPILER_RUNTIME_MODE === 'langgraph' &&
      !value.REDIS_URL
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'REDIS_URL is required when COMPILER_RUNTIME_MODE=langgraph so the LangGraph checkpointer can persist conversations.',
        path: ['REDIS_URL'],
      });
    }

    if (
      value.ORCHESTRATOR_RUNTIME_MODE !== 'disabled' &&
      !value.REDIS_URL
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'REDIS_URL is required when ORCHESTRATOR_RUNTIME_MODE is enabled so orchestrator runs can hold distributed locks.',
        path: ['REDIS_URL'],
      });
    }
  });

export type AppEnv = z.infer<typeof env_schema>;

export function resolveEnv(raw_env: NodeJS.ProcessEnv = process.env): AppEnv {
  return env_schema.parse(raw_env);
}

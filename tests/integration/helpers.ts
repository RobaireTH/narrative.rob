import pino from 'pino';
import { resolveEnv, type AppEnv } from '../../src/config/env';
import { createServices, type AppServices } from '../../src/config/services';
import { createApp } from '../../src/app';

export function buildTestEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): AppEnv {
  return resolveEnv({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3000',
    LOG_LEVEL: 'silent',
    AUTH_PROVIDER: 'disabled',
    APP_STORAGE_MODE: 'memory',
    COMPILER_RUNTIME_MODE: 'disabled',
    ORCHESTRATOR_RUNTIME_MODE: 'disabled',
    BAYSE_BASE_URL: 'http://bayse.test',
    BAYSE_LOGIN_RATE_LIMIT_SECONDS: '0',
    TRADING_MODE_DEFAULT: 'paper',
    ENABLE_PAPER_TRADING: 'true',
    ENABLE_LIVE_TRADING: 'false',
    ALLOW_NARRATIVE_IMPORT: 'false',
    INTERNAL_TOKEN: 'test-internal-token',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export function buildTestApp(env_overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const env = buildTestEnv(env_overrides);
  const logger = pino({ level: 'silent' });
  const services: AppServices = createServices({ env, logger });
  const app = createApp({ env, logger, services });
  return { app, env, logger, services };
}

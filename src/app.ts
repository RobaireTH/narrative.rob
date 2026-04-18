import express from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';

import type { AppEnv } from './config/env';
import type { AppServices } from './config/services';
import { errorHandler, notFoundHandler } from './api/middlewares/errors';
import { requestIdMiddleware } from './api/middlewares/request-id';
import { createCorsMiddleware } from './api/middlewares/cors';
import { createHttpLogger } from './infrastructure/logging/logger';
import { createHealthRouter } from './api/routes/health';
import { createBayseRouter } from './api/routes/bayse';
import { createCompilerRouter } from './api/routes/compiler';
import { createNarrativesRouter } from './api/routes/narratives';
import { createWorkspacesRouter } from './api/routes/workspaces';
import { createOrchestratorRouter } from './api/routes/orchestrator';

export interface CreateAppParams {
  env: AppEnv;
  logger: Logger;
  services: AppServices;
}

export function createApp(params: CreateAppParams) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: params.env.NODE_ENV === 'production' ? undefined : false,
  }));
  app.use(createCorsMiddleware({
    allowed_origins: params.env.CORS_ALLOWED_ORIGINS,
    node_env: params.env.NODE_ENV,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware);
  app.use(createHttpLogger(params.logger));

  app.use(createHealthRouter({
    env: params.env,
    services: params.services,
  }));

  app.use('/api/bayse', createBayseRouter({
    env: params.env,
    services: params.services,
  }));
  app.use('/api/compiler', createCompilerRouter({
    services: params.services,
  }));
  app.use('/api/narratives', createNarrativesRouter({
    env: params.env,
    services: params.services,
  }));
  app.use('/api/workspaces', createWorkspacesRouter({
    services: params.services,
  }));
  app.use('/api/orchestrator', createOrchestratorRouter({
    env: params.env,
    services: params.services,
  }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

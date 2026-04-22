import { Router } from 'express';

import type { AppEnv } from '../../config/env';
import type { AppServices } from '../../config/services';
import { createOrchestratorController } from '../controllers/orchestrator-controller';
import { asyncHandler } from '../middlewares/async-handler';
import { createRequireAuthMiddleware } from '../middlewares/auth';
import { createInternalAuthMiddleware } from '../middlewares/internal-auth';

export interface CreateOrchestratorRouterParams {
  env: AppEnv;
  services: AppServices;
}

export function createOrchestratorRouter(
  params: CreateOrchestratorRouterParams,
) {
  const router = Router();
  const controller = createOrchestratorController({
    services: params.services,
  });
  const requireAuth = createRequireAuthMiddleware(params.services);
  const requireInternal = createInternalAuthMiddleware({ env: params.env });

  router.post(
    '/threads/:threadId/run',
    requireAuth,
    asyncHandler(controller.runThread),
  );
  router.get(
    '/threads/:threadId/status',
    requireAuth,
    asyncHandler(controller.threadStatus),
  );
  router.post(
    '/threads/:threadId/pause',
    requireAuth,
    asyncHandler(controller.pauseThread),
  );
  router.post(
    '/threads/:threadId/resume',
    requireAuth,
    asyncHandler(controller.resumeThread),
  );
  router.post(
    '/internal/scheduler/sweep',
    requireInternal,
    asyncHandler(controller.sweepDueSchedules),
  );
  router.post(
    '/internal/tasks/orchestrator-run',
    requireInternal,
    asyncHandler(controller.taskRun),
  );

  return router;
}

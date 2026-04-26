import { Router } from 'express';

import type { AppServices } from '../../config/services';
import { createWorkspacesController } from '../controllers/workspaces-controller';
import { asyncHandler } from '../middlewares/async-handler';
import { createRequireAuthMiddleware } from '../middlewares/auth';

export interface CreateWorkspacesRouterParams {
  services: AppServices;
}

export function createWorkspacesRouter(
  params: CreateWorkspacesRouterParams,
) {
  const router = Router();
  const controller = createWorkspacesController({
    services: params.services,
  });
  const requireAuth = createRequireAuthMiddleware(params.services);

  router.get('/', requireAuth, asyncHandler(controller.listWorkspaces));
  router.get(
    '/:workspaceId',
    requireAuth,
    asyncHandler(controller.getWorkspace),
  );
  router.get(
    '/:workspaceId/files/:fileName',
    requireAuth,
    asyncHandler(controller.getWorkspaceFile),
  );
  router.get(
    '/:workspaceId/runs/:runId/files/:fileName',
    requireAuth,
    asyncHandler(controller.getWorkspaceRunFile),
  );
  router.post(
    '/:workspaceId/deposit',
    requireAuth,
    asyncHandler(controller.depositToWorkspace),
  );
  router.post(
    '/:workspaceId/withdraw',
    requireAuth,
    asyncHandler(controller.withdrawFromWorkspace),
  );

  return router;
}

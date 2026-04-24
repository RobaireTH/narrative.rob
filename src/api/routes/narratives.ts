import { Router } from 'express';

import type { AppEnv } from '../../config/env';
import type { AppServices } from '../../config/services';
import { createNarrativesController } from '../controllers/narratives-controller';
import { asyncHandler } from '../middlewares/async-handler';
import { createRequireAuthMiddleware } from '../middlewares/auth';

export interface CreateNarrativesRouterParams {
  env: AppEnv;
  services: AppServices;
}

export function createNarrativesRouter(
  params: CreateNarrativesRouterParams,
) {
  const router = Router();
  const controller = createNarrativesController({
    env: params.env,
    services: params.services,
  });
  const requireAuth = createRequireAuthMiddleware(params.services);

  router.get('/', requireAuth, asyncHandler(controller.listNarratives));
  router.post('/', requireAuth, asyncHandler(controller.importNarrative));
  router.post(
    '/:narrativeId/workspace',
    requireAuth,
    asyncHandler(controller.bootstrapWorkspace),
  );
  router.get(
    '/:narrativeId',
    requireAuth,
    asyncHandler(controller.getNarrative),
  );

  return router;
}

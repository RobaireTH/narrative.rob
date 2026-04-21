import { Router } from 'express';

import type { AppServices } from '../../config/services';
import { createCompilerController } from '../controllers/compiler-controller';
import { asyncHandler } from '../middlewares/async-handler';
import { createRequireAuthMiddleware } from '../middlewares/auth';

export interface CreateCompilerRouterParams {
  services: AppServices;
}

export function createCompilerRouter(
  params: CreateCompilerRouterParams,
) {
  const router = Router();
  const controller = createCompilerController({
    services: params.services,
  });
  const requireAuth = createRequireAuthMiddleware(params.services);

  router.post('/threads', requireAuth, asyncHandler(controller.createThread));
  router.post(
    '/threads/:threadId/messages',
    requireAuth,
    asyncHandler(controller.postMessage),
  );
  router.post(
    '/threads/:threadId/approve',
    requireAuth,
    asyncHandler(controller.approveThread),
  );
  router.get(
    '/threads/:threadId',
    requireAuth,
    asyncHandler(controller.getThread),
  );

  return router;
}

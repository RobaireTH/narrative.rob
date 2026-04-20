import { Router } from 'express';

import type { AppEnv } from '../../config/env';
import type { AppServices } from '../../config/services';
import { createBayseController } from '../controllers/bayse-controller';
import { asyncHandler } from '../middlewares/async-handler';
import { createRequireAuthMiddleware } from '../middlewares/auth';
import { createPerOwnerRateLimiter } from '../middlewares/rate-limit';

export interface CreateBayseRouterParams {
  env: AppEnv;
  services: AppServices;
}

export function createBayseRouter(
  params: CreateBayseRouterParams,
) {
  const router = Router();
  const controller = createBayseController({
    services: params.services,
  });
  const requireAuth = createRequireAuthMiddleware(params.services);
  const connect_limiter = createPerOwnerRateLimiter({
    name: 'bayse_connect',
    limit: 5,
    window_ms: 5 * 60_000,
  });
  const api_key_write_limiter = createPerOwnerRateLimiter({
    name: 'bayse_api_key_write',
    limit: 20,
    window_ms: 60_000,
  });

  router.post(
    '/accounts/connect',
    requireAuth,
    connect_limiter,
    asyncHandler(controller.connectAccount),
  );
  router.get(
    '/accounts/me',
    requireAuth,
    asyncHandler(controller.getConnectionStatus),
  );
  router.post(
    '/accounts/me/api-keys',
    requireAuth,
    api_key_write_limiter,
    asyncHandler(controller.createApiKey),
  );
  router.get(
    '/accounts/me/api-keys',
    requireAuth,
    asyncHandler(controller.listApiKeys),
  );
  router.post(
    '/accounts/me/api-keys/:keyId/rotate',
    requireAuth,
    api_key_write_limiter,
    asyncHandler(controller.rotateApiKey),
  );
  router.delete(
    '/accounts/me/api-keys/:keyId',
    requireAuth,
    api_key_write_limiter,
    asyncHandler(controller.deleteApiKey),
  );

  return router;
}

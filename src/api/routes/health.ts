import { Router } from 'express';

import type { AppEnv } from '../../config/env';
import type { AppServices } from '../../config/services';
import { createHealthController } from '../controllers/health-controller';

export interface CreateHealthRouterParams {
  env: AppEnv;
  services: AppServices;
}

export function createHealthRouter(
  params: CreateHealthRouterParams,
) {
  const router = Router();
  const controller = createHealthController({
    env: params.env,
    services: params.services,
  });

  router.get('/', controller.root);
  router.get('/health', controller.health);
  router.get('/ready', controller.ready);

  return router;
}

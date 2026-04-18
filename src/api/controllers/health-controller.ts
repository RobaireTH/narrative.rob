import type {
  Request,
  Response,
} from 'express';

import type { AppEnv } from '../../config/env';
import type { AppServices } from '../../config/services';

export interface CreateHealthControllerParams {
  env: AppEnv;
  services: AppServices;
}

export function createHealthController(
  params: CreateHealthControllerParams,
) {
  return {
    health(_req: Request, res: Response) {
      res.status(200).json({
        ok: true,
        request_id: res.locals.request_id,
        service: 'narrative-api',
        timestamp: new Date().toISOString(),
      });
    },

    async ready(_req: Request, res: Response) {
      const checks: Record<string, { ok: boolean; detail?: string }> = {};

      if (params.services.redis_client) {
        try {
          await params.services.redis_client.ping();
          checks.redis = { ok: true };
        } catch (error) {
          checks.redis = {
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          };
        }
      }

      const ok = Object.values(checks).every((c) => c.ok);

      res.status(ok ? 200 : 503).json({
        checks,
        ok,
        request_id: res.locals.request_id,
        storage_mode: params.env.APP_STORAGE_MODE,
        timestamp: new Date().toISOString(),
      });
    },

    root(_req: Request, res: Response) {
      res.status(200).json({
        message: 'Narrative API is running.',
        node_env: params.env.NODE_ENV,
        request_id: res.locals.request_id,
        service: 'narrative-api',
      });
    },
  };
}

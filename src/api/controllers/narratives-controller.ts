import type {
  Request,
  Response,
} from 'express';
import { z } from 'zod';

import type { AppEnv } from '../../config/env';
import type { AppServices } from '../../config/services';
import { NotFoundError } from '../../application/common/errors';
import { getAuthenticatedUser } from '../middlewares/auth';

const import_narrative_schema = z.object({
  compiler_thread_id: z.string().min(1).optional(),
  narrative: z.unknown(),
});

const bootstrap_workspace_params_schema = z.object({
  narrativeId: z.string().min(1),
});

const bootstrap_workspace_body_schema = z.object({
  base_currency: z.enum(['USD', 'NGN']).optional(),
  initial_master_liquidity: z.number().nonnegative().optional(),
  thread_id: z.string().min(1),
});

const get_narrative_params_schema = z.object({
  narrativeId: z.string().min(1),
});

export interface CreateNarrativesControllerParams {
  env: AppEnv;
  services: Pick<
    AppServices,
    'narrative_service' | 'workspace_bootstrap_service'
  >;
}

export function createNarrativesController(
  params: CreateNarrativesControllerParams,
) {
  return {
    async bootstrapWorkspace(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { narrativeId } = bootstrap_workspace_params_schema.parse(
        req.params,
      );
      const body = bootstrap_workspace_body_schema.parse(req.body);
      const result =
        await params.services.workspace_bootstrap_service.bootstrapWorkspace({
          base_currency: body.base_currency,
          initial_master_liquidity: body.initial_master_liquidity,
          narrative_id: narrativeId,
          owner_id: auth_user.uid,
          thread_id: body.thread_id,
        });

      res.status(result.reused ? 200 : 201).json({
        data: result,
        request_id: res.locals.request_id,
      });
    },

    async getNarrative(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { narrativeId } = get_narrative_params_schema.parse(req.params);
      const narrative =
        await params.services.narrative_service.getNarrative(
          narrativeId,
          auth_user.uid,
        );

      res.status(200).json({
        data: narrative,
        request_id: res.locals.request_id,
      });
    },

    async importNarrative(req: Request, res: Response) {
      if (!params.env.ALLOW_NARRATIVE_IMPORT) {
        throw new NotFoundError('Direct narrative import is disabled.');
      }

      const auth_user = getAuthenticatedUser(res);
      const body = import_narrative_schema.parse(req.body);
      const narrative =
        await params.services.narrative_service.importNarrative({
          ...body,
          owner_id: auth_user.uid,
        });

      res.status(201).json({
        data: narrative,
        request_id: res.locals.request_id,
      });
    },
  };
}

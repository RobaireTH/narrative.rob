import type {
  Request,
  Response,
} from 'express';
import { z } from 'zod';

import type { AppServices } from '../../config/services';
import { getAuthenticatedUser } from '../middlewares/auth';

const connect_bayse_account_schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const create_bayse_api_key_schema = z.object({
  name: z.string().min(1),
});

const rotate_bayse_api_key_params_schema = z.object({
  keyId: z.string().min(1),
});

export interface CreateBayseControllerParams {
  services: Pick<AppServices, 'bayse_bootstrap_service'>;
}

export function createBayseController(
  params: CreateBayseControllerParams,
) {
  return {
    async connectAccount(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const input = connect_bayse_account_schema.parse(req.body);
      const connection =
        await params.services.bayse_bootstrap_service.connectAccount({
          ...input,
          owner_id: auth_user.uid,
        });

      res.status(200).json({
        data: connection,
        meta: {
          next_step:
            'Create an API key so the backend can perform authenticated Bayse reads and signed writes.',
        },
        request_id: res.locals.request_id,
      });
    },

    async createApiKey(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const body = create_bayse_api_key_schema.parse(req.body);
      const connection =
        await params.services.bayse_bootstrap_service.createApiKey({
          name: body.name,
          owner_id: auth_user.uid,
        });

      res.status(201).json({
        data: connection,
        request_id: res.locals.request_id,
      });
    },

    async getConnectionStatus(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const connection =
        await params.services.bayse_bootstrap_service.getConnectionStatus(
          auth_user.uid,
        );

      res.status(200).json({
        data: connection,
        request_id: res.locals.request_id,
      });
    },

    async listApiKeys(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const api_keys =
        await params.services.bayse_bootstrap_service.listApiKeys(
          auth_user.uid,
        );

      res.status(200).json({
        data: api_keys,
        request_id: res.locals.request_id,
      });
    },

    async deleteApiKey(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { keyId } = rotate_bayse_api_key_params_schema.parse(req.params);
      const result =
        await params.services.bayse_bootstrap_service.deleteApiKey({
          key_id: keyId,
          owner_id: auth_user.uid,
        });

      res.status(200).json({
        data: result,
        request_id: res.locals.request_id,
      });
    },

    async rotateApiKey(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { keyId } = rotate_bayse_api_key_params_schema.parse(req.params);
      const connection =
        await params.services.bayse_bootstrap_service.rotateApiKey({
          key_id: keyId,
          owner_id: auth_user.uid,
        });

      res.status(200).json({
        data: connection,
        request_id: res.locals.request_id,
      });
    },
  };
}

import type {
  Request,
  Response,
} from 'express';
import { z } from 'zod';

import type { AppServices } from '../../config/services';
import { getAuthenticatedUser } from '../middlewares/auth';

const workspace_id_params_schema = z.object({
  workspaceId: z.string().min(1),
});

const workspace_file_params_schema = workspace_id_params_schema.extend({
  fileName: z.enum(['execution_plan', 'logs', 'narrative', 'portfolio']),
});

const deposit_body_schema = z.object({
  amount: z.number().positive().finite(),
  note: z.string().max(500).optional(),
});

export interface CreateWorkspacesControllerParams {
  services: Pick<
    AppServices,
    'portfolio_service' | 'workspace_bootstrap_service'
  >;
}

export function createWorkspacesController(
  params: CreateWorkspacesControllerParams,
) {
  return {
    async listWorkspaces(_req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const workspaces =
        await params.services.workspace_bootstrap_service.listWorkspaces(
          auth_user.uid,
        );

      res.status(200).json({
        data: workspaces,
        request_id: res.locals.request_id,
      });
    },

    async depositToWorkspace(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { workspaceId } = workspace_id_params_schema.parse(req.params);
      const body = deposit_body_schema.parse(req.body);
      const result = await params.services.portfolio_service.deposit({
        amount: body.amount,
        note: body.note,
        owner_id: auth_user.uid,
        workspace_id: workspaceId,
      });

      res.status(200).json({
        data: result,
        request_id: res.locals.request_id,
      });
    },

    async getWorkspace(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { workspaceId } = workspace_id_params_schema.parse(req.params);
      const workspace =
        await params.services.workspace_bootstrap_service.getWorkspace({
          owner_id: auth_user.uid,
          workspace_id: workspaceId,
        });

      res.status(200).json({
        data: workspace,
        request_id: res.locals.request_id,
      });
    },

    async getWorkspaceFile(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { fileName, workspaceId } =
        workspace_file_params_schema.parse(req.params);
      const file =
        await params.services.workspace_bootstrap_service.getWorkspaceFile({
          file_name: fileName,
          owner_id: auth_user.uid,
          workspace_id: workspaceId,
        });

      res.status(200).json({
        data: {
          content: file.content,
          content_type: file.content_type,
          object_key: file.object_key,
        },
        request_id: res.locals.request_id,
      });
    },
  };
}

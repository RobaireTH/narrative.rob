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

export interface CreateWorkspacesControllerParams {
  services: Pick<AppServices, 'workspace_bootstrap_service'>;
}

export function createWorkspacesController(
  params: CreateWorkspacesControllerParams,
) {
  return {
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

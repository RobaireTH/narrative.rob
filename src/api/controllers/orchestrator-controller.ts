import type {
  Request,
  Response,
} from 'express';
import { z } from 'zod';

import type { AppServices } from '../../config/services';
import { getAuthenticatedUser } from '../middlewares/auth';

const thread_params_schema = z.object({
  threadId: z.string().min(1),
});

const internal_task_run_body_schema = z.object({
  idempotency_key: z.string().min(1).optional(),
  thread_id: z.string().min(1),
});

export interface CreateOrchestratorControllerParams {
  services: Pick<AppServices, 'orchestrator_service'>;
}

export function createOrchestratorController(
  params: CreateOrchestratorControllerParams,
) {
  return {
    async pauseThread(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { threadId } = thread_params_schema.parse(req.params);
      const schedule =
        await params.services.orchestrator_service.pauseThread({
          owner_id: auth_user.uid,
          thread_id: threadId,
        });

      res.status(200).json({
        data: schedule,
        request_id: res.locals.request_id,
      });
    },

    async resumeThread(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { threadId } = thread_params_schema.parse(req.params);
      const schedule =
        await params.services.orchestrator_service.resumeThread({
          owner_id: auth_user.uid,
          thread_id: threadId,
        });

      res.status(200).json({
        data: schedule,
        request_id: res.locals.request_id,
      });
    },

    async runThread(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { threadId } = thread_params_schema.parse(req.params);
      const result = await params.services.orchestrator_service.runThread({
        owner_id: auth_user.uid,
        thread_id: threadId,
        trigger: 'manual',
      });

      res.status(200).json({
        data: result,
        request_id: res.locals.request_id,
      });
    },

    async sweepDueSchedules(_req: Request, res: Response) {
      const result =
        await params.services.orchestrator_service.sweepDueSchedules();

      res.status(200).json({
        data: result,
        request_id: res.locals.request_id,
      });
    },

    async taskRun(req: Request, res: Response) {
      const body = internal_task_run_body_schema.parse(req.body);
      const result = await params.services.orchestrator_service.runThread({
        thread_id: body.thread_id,
        trigger: 'task',
      });

      res.status(200).json({
        data: result,
        request_id: res.locals.request_id,
      });
    },

    async threadStatus(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { threadId } = thread_params_schema.parse(req.params);
      const status =
        await params.services.orchestrator_service.getStatus({
          owner_id: auth_user.uid,
          thread_id: threadId,
        });

      res.status(200).json({
        data: status,
        request_id: res.locals.request_id,
      });
    },
  };
}

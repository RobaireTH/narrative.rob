import type {
  Request,
  Response,
} from 'express';
import { z } from 'zod';

import type { AppServices } from '../../config/services';
import { getAuthenticatedUser } from '../middlewares/auth';

const create_compiler_thread_schema = z.object({
  source_conversation_id: z.string().min(1).optional(),
});

const compiler_message_body_schema = z.object({
  content: z.string().min(1),
});

const compiler_thread_params_schema = z.object({
  threadId: z.string().min(1),
});

export interface CreateCompilerControllerParams {
  services: Pick<AppServices, 'compiler_service'>;
}

export function createCompilerController(
  params: CreateCompilerControllerParams,
) {
  return {
    async approveThread(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { threadId } = compiler_thread_params_schema.parse(req.params);
      const thread =
        await params.services.compiler_service.approveThread({
          owner_id: auth_user.uid,
          thread_id: threadId,
        });

      res.status(200).json({
        data: thread,
        request_id: res.locals.request_id,
      });
    },

    async createThread(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const input = create_compiler_thread_schema.parse(req.body);
      const thread =
        await params.services.compiler_service.createThread({
          narrator_id: auth_user.uid,
          owner_id: auth_user.uid,
          source_conversation_id: input.source_conversation_id,
        });

      res.status(201).json({
        data: thread,
        request_id: res.locals.request_id,
      });
    },

    async streamThread(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { threadId } = compiler_thread_params_schema.parse(req.params);
      const thread = await params.services.compiler_service.getThread({
        owner_id: auth_user.uid,
        thread_id: threadId,
      });

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      send('thread_updated', { thread });

      const event_bus = params.services.compiler_service.getEventBus();
      const unsubscribe = event_bus?.subscribe(threadId, (event) => {
        if (event.type === 'thread_updated') {
          if (event.thread.owner_id !== auth_user.uid) {
            return;
          }
          send('thread_updated', { thread: event.thread });
        } else if (event.type === 'thread_error') {
          send('thread_error', { error: event.error });
        }
      });

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe?.();
        if (!res.writableEnded) {
          res.end();
        }
      };

      req.on('close', cleanup);
      req.on('aborted', cleanup);
      res.on('close', cleanup);
    },

    async listThreads(_req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const threads =
        await params.services.compiler_service.listThreads(auth_user.uid);

      res.status(200).json({
        data: threads,
        request_id: res.locals.request_id,
      });
    },

    async getThread(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { threadId } = compiler_thread_params_schema.parse(req.params);
      const thread =
        await params.services.compiler_service.getThread({
          owner_id: auth_user.uid,
          thread_id: threadId,
        });

      res.status(200).json({
        data: thread,
        request_id: res.locals.request_id,
      });
    },

    async postMessage(req: Request, res: Response) {
      const auth_user = getAuthenticatedUser(res);
      const { threadId } = compiler_thread_params_schema.parse(req.params);
      const body = compiler_message_body_schema.parse(req.body);
      const thread =
        await params.services.compiler_service.postUserMessage({
          content: body.content,
          owner_id: auth_user.uid,
          thread_id: threadId,
        });

      res.status(200).json({
        data: thread,
        request_id: res.locals.request_id,
      });
    },
  };
}

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';

import type { AppEnv } from '../../config/env';
import { UnauthorizedError } from '../../application/common/errors';

export interface CreateInternalAuthMiddlewareParams {
  env: AppEnv;
}

export function createInternalAuthMiddleware(
  params: CreateInternalAuthMiddlewareParams,
): RequestHandler {
  const oauth_client = new OAuth2Client();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (params.env.INTERNAL_TOKEN) {
        const header = req.header('x-internal-token');
        if (header === params.env.INTERNAL_TOKEN) {
          res.locals.internal_caller = { kind: 'shared-secret' };
          next();
          return;
        }
      }

      const authorization = req.header('authorization');
      if (authorization?.toLowerCase().startsWith('bearer ')) {
        const token = authorization.slice('bearer '.length).trim();
        const audience = params.env.CLOUD_TASKS_ORCHESTRATOR_URL;

        if (!audience) {
          throw new UnauthorizedError(
            'Internal endpoints require CLOUD_TASKS_ORCHESTRATOR_URL to be configured for OIDC verification.',
          );
        }

        const ticket = await oauth_client.verifyIdToken({
          audience,
          idToken: token,
        });
        const payload = ticket.getPayload();

        if (!payload) {
          throw new UnauthorizedError('Invalid OIDC token.');
        }

        const allowed_sa = params.env.CLOUD_TASKS_SERVICE_ACCOUNT;
        if (allowed_sa && payload.email !== allowed_sa) {
          throw new UnauthorizedError(
            `OIDC token email "${payload.email ?? 'unknown'}" is not allowed.`,
          );
        }

        res.locals.internal_caller = {
          email: payload.email,
          kind: 'oidc',
        };
        next();
        return;
      }

      throw new UnauthorizedError(
        'Internal endpoint requires x-internal-token or OIDC bearer token.',
      );
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        next(error);
        return;
      }
      next(
        new UnauthorizedError(
          error instanceof Error
            ? error.message
            : 'Internal authentication failed.',
        ),
      );
    }
  };
}

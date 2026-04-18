import type {
  NextFunction,
  Request,
  Response,
  RequestHandler,
} from 'express';

import type {
  AppServices,
} from '../../config/services';
import type {
  AuthenticatedUser,
} from '../../application/auth/service';
import {
  UnauthorizedError,
} from '../../application/common/errors';

function extractBearerToken(req: Request) {
  const authorization = req.header('authorization');

  if (!authorization) {
    throw new UnauthorizedError('Missing Authorization header.');
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedError(
      'Authorization header must use the Bearer scheme.',
    );
  }

  return token;
}

export function createRequireAuthMiddleware(
  services: Pick<AppServices, 'auth_service'>,
): RequestHandler {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const token = extractBearerToken(req);
      const auth_user =
        await services.auth_service.verifyBearerToken(token);

      res.locals.auth_user = auth_user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getAuthenticatedUser(
  res: Response,
): AuthenticatedUser {
  const auth_user = res.locals.auth_user as AuthenticatedUser | undefined;

  if (!auth_user) {
    throw new UnauthorizedError(
      'Authenticated user context is missing on the request.',
    );
  }

  return auth_user;
}

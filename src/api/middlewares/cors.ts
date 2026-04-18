import cors, { type CorsOptions } from 'cors';
import type { RequestHandler } from 'express';

export interface CreateCorsMiddlewareParams {
  allowed_origins: string[];
  node_env: string;
}

export function createCorsMiddleware(
  params: CreateCorsMiddlewareParams,
): RequestHandler {
  const options: CorsOptions = {
    origin(request_origin, callback) {
      if (!request_origin) {
        callback(null, true);
        return;
      }

      if (params.allowed_origins.length === 0) {
        if (params.node_env === 'production') {
          callback(new Error(`Origin "${request_origin}" is not allowed.`));
          return;
        }

        callback(null, true);
        return;
      }

      if (params.allowed_origins.includes(request_origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin "${request_origin}" is not allowed.`));
    },
    credentials: true,
    methods: ['DELETE', 'GET', 'OPTIONS', 'POST', 'PUT'],
  };

  return cors(options);
}

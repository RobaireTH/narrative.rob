import pino, { type Logger, type LoggerOptions } from 'pino';
import pinoHttp, { type HttpLogger } from 'pino-http';
import type { Request, Response } from 'express';

const sensitive_paths = [
  'req.headers.authorization',
  'req.headers["x-auth-token"]',
  'req.headers.cookie',
  'password',
  'token',
  'secret_key',
  'private_key',
  'ANTHROPIC_API_KEY',
];

export interface CreateLoggerParams {
  level?: string;
  node_env: string;
  service_name?: string;
}

export function createLogger(params: CreateLoggerParams): Logger {
  const options: LoggerOptions = {
    base: {
      service: params.service_name ?? 'narrative-api',
      env: params.node_env,
    },
    level: params.level ?? (params.node_env === 'production' ? 'info' : 'debug'),
    redact: {
      paths: sensitive_paths,
      remove: true,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (params.node_env !== 'production') {
    options.transport = {
      target: 'pino/file',
      options: {
        destination: 1,
      },
    };
  }

  return pino(options);
}

export function createHttpLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    customProps: (_req, res) => {
      const locals = (res as Response).locals ?? {};
      return {
        request_id: locals.request_id,
        auth_provider: (locals.auth_user as { auth_provider?: string } | undefined)?.auth_provider,
      };
    },
    customLogLevel: (_req, res, error) => {
      if (error) return 'error';
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req: Request) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remote_ip: req.ip,
      }),
    },
  });
}

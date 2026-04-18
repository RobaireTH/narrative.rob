import dotenv from 'dotenv';

import { createApp } from './app';
import { resolveEnv } from './config/env';
import { createServices, shutdownServices } from './config/services';
import { createLogger } from './infrastructure/logging/logger';

dotenv.config();

const env = resolveEnv();
const logger = createLogger({
  level: env.LOG_LEVEL,
  node_env: env.NODE_ENV,
});

async function main() {
  const services = createServices({ env, logger });
  const app = createApp({ env, logger, services });

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      { host: env.HOST, port: env.PORT, storage_mode: env.APP_STORAGE_MODE },
      'Narrative API listening',
    );
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let shutting_down = false;
  const shutdown = async (signal: string) => {
    if (shutting_down) return;
    shutting_down = true;
    logger.info({ signal }, 'shutdown initiated');

    const force_timer = setTimeout(() => {
      logger.warn('shutdown grace period elapsed, forcing exit');
      process.exit(1);
    }, 15_000);
    force_timer.unref();

    server.close(async (close_error) => {
      if (close_error) {
        logger.error({ err: close_error }, 'http server close error');
      }

      try {
        await shutdownServices(services);
      } catch (service_error) {
        logger.error({ err: service_error }, 'service shutdown error');
      }

      clearTimeout(force_timer);
      logger.info('shutdown complete');
      process.exit(close_error ? 1 : 0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    void shutdown('uncaughtException');
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'failed to start');
  process.exit(1);
});

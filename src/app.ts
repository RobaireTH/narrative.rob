import cors from 'cors';
import express from 'express';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'narrative-api',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/', (_req, res) => {
    res.status(200).json({
      message: 'Narrative API is running.',
    });
  });

  return app;
}

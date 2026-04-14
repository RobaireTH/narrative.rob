import dotenv from 'dotenv';

import { createApp } from './app';

dotenv.config();

const app = createApp();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);

app.listen(port, host, () => {
  console.log(`Narrative API listening on http://${host}:${port}`);
});

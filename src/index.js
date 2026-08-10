import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { createApp } from './app.js';
import { env } from './env.js';

const app = createApp();
app.use('/*', serveStatic({ root: './public' }));

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`redact-paperasse-demo listening on :${info.port}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

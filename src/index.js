import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { createApp } from './app.js';
import { env } from './env.js';

const app = createApp();
// The entire UI is one HTML file, so a cached copy means a deploy silently
// doesn't reach anyone who has already visited -- which is exactly what
// happened while chasing a layout bug. Revalidate every time; it's a few KB.
app.use('/*', serveStatic({
  root: './public',
  onFound: (_path, c) => {
    c.header('Cache-Control', 'no-cache, must-revalidate');
  },
}));

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`redact-paperasse-demo listening on :${info.port}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

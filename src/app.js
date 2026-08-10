import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { withConcurrencyLimit } from './concurrency.js';
import { getCount, incrementCount } from './counter.js';
import { env } from './env.js';
import { ENTITY_TYPES, redactUpload, SUPPORTED_MIME_TYPES } from './redact.js';
import { rateLimit } from './rateLimit.js';

export function createApp() {
  const app = new Hono();
  app.use('*', cors());

  // Dependency-free, matching paperasse.ai-poc/apps/backend's /health —
  // deploy.sh curls this, it must stay green even if something else degrades.
  app.get('/health', (c) => c.json({ status: 'ok', service: 'redact-paperasse-demo' }));

  app.get('/entities', (c) => c.json({ entities: ENTITY_TYPES }));

  app.get('/stats', (c) => c.json({ count: getCount() }));

  app.post('/redact', async (c) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';
    if (!rateLimit(ip, env.RATE_LIMIT_PER_MIN)) {
      return c.json({ error: 'Too many requests — try again in a minute.' }, 429);
    }

    let formData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: 'Expected multipart/form-data with a "file" field.' }, 400);
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return c.json({ error: 'Missing "file" field.' }, 400);
    }
    if (file.size === 0) {
      return c.json({ error: 'Uploaded file is empty.' }, 400);
    }
    if (file.size > env.MAX_UPLOAD_BYTES) {
      return c.json(
        { error: `File too large — max ${Math.floor(env.MAX_UPLOAD_BYTES / (1024 * 1024))}MB.` },
        413,
      );
    }
    if (!SUPPORTED_MIME_TYPES.has(file.type)) {
      return c.json(
        { error: `Unsupported file type "${file.type}". Use plain text, PNG, JPEG, or PDF.` },
        415,
      );
    }

    let entities;
    const entitiesRaw = formData.get('entities');
    if (typeof entitiesRaw === 'string' && entitiesRaw.length > 0) {
      try {
        entities = JSON.parse(entitiesRaw);
      } catch {
        return c.json({ error: '"entities" must be a JSON array of entity type IDs.' }, 400);
      }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      const result = await withConcurrencyLimit(env.MAX_CONCURRENT_REDACTIONS, () =>
        redactUpload(bytes, file.type, entities),
      );
      incrementCount();
      const safeName = (file.name || 'output').replace(/[^\w.\-]/g, '_');
      return new Response(result.bytes, {
        headers: {
          'Content-Type': result.mimeType,
          'Content-Disposition': `attachment; filename="redacted-${safeName}"`,
        },
      });
    } catch (err) {
      console.error('redaction failed:', err);
      return c.json({ error: 'Redaction failed. Please try a different file.' }, 500);
    }
  });

  return app;
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { withConcurrencyLimit } from './concurrency.js';
import { getCount, incrementCount } from './counter.js';
import { env } from './env.js';
import { ENTITY_TYPES, redactUpload, SUPPORTED_MIME_TYPES } from './redact.js';
import { rateLimit } from './rateLimit.js';

// The page defaults to French, so errors do too; `?lang=en` opts out. Kept as
// one helper rather than sprinkling ternaries, so adding a language later is
// one edit per string instead of one per call site.
const msg = (c, fr, en) => (c.req.query('lang') === 'en' ? en : fr);

export function createApp() {
  const app = new Hono();
  app.use('*', cors());

  // Dependency-free, matching paperasse.ai-poc/apps/backend's /health —
  // deploy.sh curls this, it must stay green even if something else degrades.
  app.get('/health', (c) => c.json({ status: 'ok', service: 'redact-paperasse-demo' }));

  // French is the default everywhere, including here: `?lang=en` is the
  // opt-in, so a client that forgets the parameter still gets French rather
  // than silently falling back to English.
  app.get('/entities', (c) => c.json({
    entities: ENTITY_TYPES
      // NER chips only exist when an analyzer is configured -- absence of
      // the chip is the honest signal, not a chip that errors when used.
      .filter((e) => !e.ner || env.PRESIDIO_ANALYZER_URL)
      .map(({ id, label, label_en, default_on }) => ({
        id,
        label: c.req.query('lang') === 'en' ? label_en : label,
        default_on: default_on !== false,
      })),
  }));

  app.get('/stats', (c) => c.json({ count: getCount() }));

  app.post('/redact', async (c) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown';
    if (!rateLimit(ip, env.RATE_LIMIT_PER_MIN)) {
      return c.json({ error: msg(c, 'Trop de requêtes — réessayez dans une minute.', 'Too many requests — try again in a minute.') }, 429);
    }

    let formData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: msg(c, 'Requête multipart/form-data attendue, avec un champ "file".', 'Expected multipart/form-data with a "file" field.') }, 400);
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return c.json({ error: msg(c, 'Champ "file" manquant.', 'Missing "file" field.') }, 400);
    }
    if (file.size === 0) {
      return c.json({ error: msg(c, 'Le fichier envoyé est vide.', 'Uploaded file is empty.') }, 400);
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
        return c.json({ error: msg(c, '"entities" doit être un tableau JSON d\'identifiants de types.', '"entities" must be a JSON array of entity type IDs.') }, 400);
      }
    }

    const markdown = formData.get('markdown') === 'true';
    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      const result = await withConcurrencyLimit(env.MAX_CONCURRENT_REDACTIONS, () =>
        redactUpload(bytes, file.type, entities, markdown, {
          analyzerUrl: env.PRESIDIO_ANALYZER_URL,
          // The UI language doubles as the NER language: this demo is
          // French-first and the documents people bring it are French; an
          // English-UI visitor analyzing with the English model is the
          // right pairing for the other case.
          language: c.req.query('lang') === 'en' ? 'en' : 'fr',
        }),
      );
      incrementCount();
      let safeName = (file.name || 'output').replace(/[^\w.\-]/g, '_');
      // Markdown output is a different file than what was uploaded — swap
      // the extension so the download isn't a .jpeg full of text.
      if (result.extension) {
        safeName = `${safeName.replace(/\.[^.]+$/, '')}.${result.extension}`;
      }
      return new Response(result.bytes, {
        headers: {
          'Content-Type': result.mimeType,
          'Content-Disposition': `attachment; filename="redacted-${safeName}"`,
        },
      });
    } catch (err) {
      console.error('redaction failed:', err);
      return c.json({ error: msg(c, 'Le caviardage a échoué. Essayez un autre fichier.', 'Redaction failed. Please try a different file.') }, 500);
    }
  });

  return app;
}

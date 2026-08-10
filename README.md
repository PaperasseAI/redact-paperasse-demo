# redact-paperasse-demo

A small public demo of [`redact-paperasse`](https://github.com/PaperasseAI/redact-paperasse) — upload plain text, a PNG/JPEG image, or a PDF, pick which kinds of PII to redact, and get a redacted copy back.

Live at [redact.paperasse.ai](https://redact.paperasse.ai).

## How it works

- **Backend**: [Hono](https://hono.dev) on Node 22, one flat router (`src/app.js`). `POST /redact` takes a multipart upload + a JSON `entities` array, dispatches to `redactText`/`redactImage`/`redactPdf` from the `redact-paperasse` npm package by MIME type, and streams the redacted bytes straight back as the response body.
- **No files ever touch disk.** The upload is read into memory, redacted in memory, and served back in the same request — "delete after download" is true by construction, not a cleanup step working against a file that was ever written.
- **Frontend**: a single static page (`public/index.html`), vanilla JS, no build step.
- **Counter**: `data/stats.json`, incremented per successful redaction, written via an atomic temp-file-then-rename swap so a crash mid-write can't corrupt it. The UI only shows the running count once it passes 1000.
- **Abuse protection**: a 10MB upload cap, a MIME-type allowlist, a simple per-IP rate limit, and a concurrency cap on simultaneous redactions (OCR/PDF rendering is the expensive part, not the HTTP handling).

## Supported entity types

Whatever `redact-paperasse` currently registers as Tier A recognizers: email addresses, phone numbers, credit card numbers, IBANs, US Social Security Numbers, and French social security numbers (NIR). See `src/redact.js` for the exact list — the library doesn't expose a "list supported entities" call today, so this is hand-kept in sync with [`crates/recognizers/src/lib.rs`](https://github.com/PaperasseAI/redact-paperasse/blob/main/crates/recognizers/src/lib.rs).

## Local development

```sh
npm install
cp .env.example .env
npm run dev
```

Then open `http://localhost:8790`.

## Deployment

Deployment configuration (server details, hostnames) is intentionally not included in this repo — it's environment-specific and kept out of version control.

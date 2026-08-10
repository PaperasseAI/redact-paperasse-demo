import { redactImage, redactPdf, redactText } from 'redact-paperasse';

// The 6 recognizers currently registered in
// redact-paperasse/crates/recognizers/src/lib.rs::default_registry() — the
// library doesn't expose a "list supported entities" call today, so this
// is hand-kept in sync with that registry.
export const ENTITY_TYPES = [
  { id: 'EMAIL_ADDRESS', label: 'Email address' },
  { id: 'PHONE_NUMBER', label: 'Phone number' },
  { id: 'CREDIT_CARD', label: 'Credit card number' },
  { id: 'IBAN_CODE', label: 'IBAN' },
  { id: 'US_SSN', label: 'US Social Security Number' },
  { id: 'FR_NIR', label: 'French social security number (NIR)' },
];

export const SUPPORTED_MIME_TYPES = new Set([
  'text/plain',
  'image/png',
  'image/jpeg',
  'application/pdf',
]);

/**
 * Redact an uploaded file entirely in memory and return the redacted bytes
 * + the mime type to serve them back as. Never touches disk: the redacted
 * result is the HTTP response body for the same request that uploaded the
 * file, so "delete after download" is true by construction rather than a
 * cleanup step working against a file that was ever written.
 */
export async function redactUpload(bytes, mimeType, entities) {
  const options = entities && entities.length > 0 ? { entities } : undefined;

  switch (mimeType) {
    case 'text/plain': {
      const text = Buffer.from(bytes).toString('utf8');
      // markdown: false — this produces a downloadable .txt file, not text
      // fed to an LLM, so the useful default is "same shape as the input",
      // not the markdown-by-default behavior redactText uses for agents.
      const redacted = await redactText(text, { ...options, markdown: false });
      return { bytes: Buffer.from(redacted, 'utf8'), mimeType: 'text/plain' };
    }
    case 'image/png':
    case 'image/jpeg': {
      const redacted = await redactImage(Buffer.from(bytes), options);
      return { bytes: redacted, mimeType };
    }
    case 'application/pdf': {
      const redacted = await redactPdf(Buffer.from(bytes), options);
      return { bytes: redacted, mimeType: 'application/pdf' };
    }
    default:
      throw new Error(`unsupported mime type: ${mimeType}`);
  }
}

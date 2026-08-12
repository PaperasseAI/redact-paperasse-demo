import {
  redactImage,
  redactImageText,
  redactPdf,
  redactPdfText,
  redactText,
} from 'redact-paperasse';

// The 6 recognizers currently registered in
// redact-paperasse/crates/recognizers/src/lib.rs::default_registry() — the
// library doesn't expose a "list supported entities" call today, so this
// is hand-kept in sync with that registry.
export const ENTITY_TYPES = [
  { id: 'EMAIL_ADDRESS', label: 'Adresse e-mail', label_en: 'Email address' },
  { id: 'PHONE_NUMBER', label: 'Numéro de téléphone', label_en: 'Phone number' },
  { id: 'CREDIT_CARD', label: 'Numéro de carte bancaire', label_en: 'Credit card number' },
  { id: 'IBAN_CODE', label: 'IBAN', label_en: 'IBAN' },
  { id: 'US_SSN', label: 'Numéro de sécurité sociale américain', label_en: 'US Social Security Number' },
  { id: 'FR_NIR', label: 'Numéro de sécurité sociale (NIR)', label_en: 'French social security number (NIR)' },
  { id: 'EU_VAT', label: 'Numéro de TVA intracommunautaire', label_en: 'EU VAT number' },
  // Off by default: a SIREN/SIRET is public data and French invoices are
  // legally required to carry it, so redacting one can invalidate the
  // document. Real cases exist (an entreprise individuelle's SIRET is tied
  // to a person), but they are the minority, so this is chosen not assumed.
  { id: 'FR_SIRET', label: 'SIRET (entreprise)', label_en: 'SIRET (company)', default_on: false },
  { id: 'FR_SIREN', label: 'SIREN (entreprise)', label_en: 'SIREN (company)', default_on: false },
  // NER-backed (Presidio, Tier B): only offered when PRESIDIO_ANALYZER_URL
  // is configured -- the chip appearing IS the feature detection. Beta and
  // off by default: NER is probabilistic where everything above is
  // checksum-anchored, and the fail-closed engine errors the whole request
  // if the analyzer is down, which an unticked-by-default chip keeps from
  // breaking the common path.
  { id: 'PERSON', label: 'Noms de personnes (beta)', label_en: 'People\u2019s names (beta)', default_on: false, ner: true },
  { id: 'LOCATION', label: 'Adresses et lieux (beta)', label_en: 'Addresses and places (beta)', default_on: false, ner: true },
];

/** The entity ids that require the Presidio pass rather than Tier A. */
const NER_IDS = new Set(ENTITY_TYPES.filter((e) => e.ner).map((e) => e.id));

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
 *
 * `markdown: false` (the default) returns the same shape that went in — a
 * redacted image stays an image with black boxes drawn on it, a PDF stays a
 * PDF. `markdown: true` returns redacted markdown text instead, whatever
 * the input was: for an image or PDF that means OCR the page, find PII in
 * the OCR'd text, and hand back the redacted text with no pixel work at
 * all (`redactImageText`/`redactPdfText`) — which is both cheaper and what
 * you actually want when the destination is an LLM rather than a human
 * looking at a document.
 */
export async function redactUpload(bytes, mimeType, entities, markdown = false, opts = {}) {
  const { analyzerUrl, language = 'fr' } = opts;
  const wantsNer = (entities ?? []).some((e) => NER_IDS.has(e));
  if (wantsNer && !analyzerUrl) {
    // The chips shouldn't exist without the env var, but a hand-crafted
    // request can still ask. Refusing beats silently returning a document
    // with the names still on it.
    throw new Error('names/addresses redaction requested but no analyzer is configured');
  }
  const options = {
    ...(entities && entities.length > 0 ? { entities } : {}),
    ...(wantsNer ? { tierB: { analyzerUrl, language } } : {}),
  };
  if (Object.keys(options).length === 0) {
    return redactDispatch(bytes, mimeType, undefined, markdown);
  }
  return redactDispatch(bytes, mimeType, options, markdown);
}

async function redactDispatch(bytes, mimeType, options, markdown) {

  if (markdown) {
    let text;
    switch (mimeType) {
      case 'text/plain':
        text = await redactText(Buffer.from(bytes).toString('utf8'), {
          ...options,
          markdown: true,
        });
        break;
      case 'image/png':
      case 'image/jpeg':
        text = await redactImageText(Buffer.from(bytes), options);
        break;
      case 'application/pdf':
        text = await redactPdfText(Buffer.from(bytes), options);
        break;
      default:
        throw new Error(`unsupported mime type: ${mimeType}`);
    }
    return { bytes: Buffer.from(text, 'utf8'), mimeType: 'text/markdown', extension: 'md' };
  }

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

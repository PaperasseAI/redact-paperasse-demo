import { z } from 'zod';

// Node 22+: loads .env into process.env without overwriting host-injected
// vars, same convention as paperasse.ai-poc/apps/backend/src/env.ts. Safe
// to call even with no .env file present (e.g. in production, where env
// vars come from the host/pm2 directly).
if (process.loadEnvFile) {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file — fine, defaults/host env apply
  }
}

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8790),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
  MAX_CONCURRENT_REDACTIONS: z.coerce.number().int().positive().default(2),
  // Where the redaction counter lives. Defaults to ./data relative to the
  // working directory; set this to pin it somewhere explicit.
  DATA_DIR: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);

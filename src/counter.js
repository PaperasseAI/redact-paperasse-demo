import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { env } from './env.js';

// Resolved against the working directory, NOT import.meta.url. Found the
// hard way on the first real deploy: esbuild bundles every src/ module into
// a single server.mjs at the app root, so an import.meta.url-relative
// "../data" that pointed at <repo>/data in dev silently escaped one level
// up in production and wrote to the app directory's *parent*. cwd is stable
// across both (pm2 starts with --cwd <app dir>; npm start runs from the
// repo root), and DATA_DIR can override it outright.
const STATS_PATH = env.DATA_DIR
  ? join(resolve(env.DATA_DIR), 'stats.json')
  : join(process.cwd(), 'data', 'stats.json');

function loadCount() {
  if (!existsSync(STATS_PATH)) return 0;
  try {
    const data = JSON.parse(readFileSync(STATS_PATH, 'utf8'));
    return typeof data.count === 'number' ? data.count : 0;
  } catch {
    return 0;
  }
}

let count = loadCount();

export function getCount() {
  return count;
}

// Atomic write (temp file + rename, the same pattern deploy.sh uses for its
// own content swaps): a crash mid-write can never leave stats.json
// truncated or corrupt, since rename() on the same filesystem is atomic.
export function incrementCount() {
  count += 1;
  const dir = dirname(STATS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${STATS_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify({ count }));
  renameSync(tmpPath, STATS_PATH);
  return count;
}

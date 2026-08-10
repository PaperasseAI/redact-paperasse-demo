import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATS_PATH = fileURLToPath(new URL('../data/stats.json', import.meta.url));

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

// Atomic write (temp file + rename, same pattern deploy.sh itself uses for
// content swaps): a crash mid-write can never leave stats.json truncated
// or corrupt, since rename() on the same filesystem is atomic.
export function incrementCount() {
  count += 1;
  const dir = dirname(STATS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${STATS_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify({ count }));
  renameSync(tmpPath, STATS_PATH);
  return count;
}

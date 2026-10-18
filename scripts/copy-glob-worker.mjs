import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const destination = resolve(process.argv[2]);
mkdirSync(destination, { recursive: true });
copyFileSync(fileURLToPath(new URL('../src/ai/tools/glob-worker.mjs', import.meta.url)), resolve(destination, 'glob-worker.mjs'));

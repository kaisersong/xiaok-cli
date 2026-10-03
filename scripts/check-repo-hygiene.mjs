#!/usr/bin/env node

export { evaluateRepoHealth, parseStatusPorcelain, collectWorkspaceHealth } from './check-repo-hygiene.js';
import { pathToFileURL } from 'node:url';
import { main } from './check-repo-hygiene.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[repo-hygiene] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

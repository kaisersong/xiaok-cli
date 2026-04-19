#!/usr/bin/env node

export { evaluateRepoHealth, parseStatusPorcelain } from './check-repo-hygiene.js';
import { main } from './check-repo-hygiene.js';

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[repo-hygiene] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

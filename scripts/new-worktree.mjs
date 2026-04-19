#!/usr/bin/env node

export { buildWorktreePath, planWorktreeAdd, sanitizeBranchName } from './new-worktree.js';
import { main } from './new-worktree.js';

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[worktree-new] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

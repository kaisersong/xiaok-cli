import { afterAll, inject } from 'vitest';
import { mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

// Read only the actual registered recipe. All mutable profile state stays private.
const config = realpathSync(mkdtempSync(join(inject('profileTestAccountRoot'), 'qualified-config-')));
const previous = process.env.XIAOK_CONFIG_DIR;
afterAll(() => {
  if (process.env.XIAOK_CONFIG_DIR !== config) throw Error('qualified_recipe_config_restore_conflict');
  if (previous === undefined) delete process.env.XIAOK_CONFIG_DIR;
  else process.env.XIAOK_CONFIG_DIR = previous;
});
process.env.XIAOK_CONFIG_DIR = config;

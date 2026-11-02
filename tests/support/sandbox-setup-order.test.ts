import {expect,inject,it} from 'vitest';
import {realpathSync} from 'node:fs';
import {relative} from 'node:path';
import {PROVIDER_ENV_PREFIXES} from './host-env.js';
import {resolveProfileAccountHome} from '../../src/runtime/verification/profile-account-home.js';

// Both sandbox setupFiles must run, host-env scrub first, then account isolation.
it('runs host-env scrub and profile account isolation for every sandbox worker',async()=>{
  const config=(await import(new URL('../../../vitest.sandbox.config.mjs',import.meta.url).href)).default as {test:{setupFiles:string[];sequence?:{setupFiles?:string}}};
  expect(config.test.setupFiles).toEqual(['./.test-dist/tests/support/setup-host-env.js','./tests/support/profile-account.setup.mjs']);
  expect(config.test.sequence?.setupFiles).toBe('list');
  const accountRoot=inject('profileTestAccountRoot' as never) as unknown;expect(typeof accountRoot).toBe('string');
  const home=realpathSync(process.env.HOME!),rel=relative(realpathSync(accountRoot as string),home);
  expect(rel.startsWith('account-')&&!rel.includes('/')).toBe(true);
  expect(process.env.XIAOK_CONFIG_DIR).toBeUndefined();expect(resolveProfileAccountHome().home).toBe(process.env.HOME);
  for(const prefix of PROVIDER_ENV_PREFIXES)expect(process.env[`${prefix}_API_KEY`]).toBeUndefined();
});

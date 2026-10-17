import { describe, expect, it } from 'vitest';
import { buildSidecarEnv, SIDECAR_ENV_NAMES, SIDECAR_ENV_PREFIXES } from '../../electron/sidecar-env.js';

const secrets = ['GH_TOKEN', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'FOO_SECRET', 'BROKER_API_KEY', 'YZJ_APP_SECRET', 'NOT_KSWARM_X', 'KSWARMX'];
describe('sidecar named environment', () => {
  it('passes every named capability and exactly the two sidecar prefixes', () => {
    const required = ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSH_AUTH_SOCK',
      'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
      'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'PATH', 'XIAOK_NODE_CMD'];
    for (const name of required) expect(SIDECAR_ENV_NAMES).toContain(name);
    const names = [...SIDECAR_ENV_NAMES, 'KSWARM_FOO', 'INTENT_BROKER_BAR', 'KSWARM_API_KEY', 'KSWARM_RUNTIME_TOKEN'];
    const parent = Object.fromEntries([...names, ...secrets].map(name => [name, `value:${name}`]));
    const env = buildSidecarEnv(parent, 'linux');
    for (const name of names) expect(env[name]).toBe(parent[name]);
    for (const name of secrets) expect(env).not.toHaveProperty(name);
    expect(SIDECAR_ENV_PREFIXES).toEqual(['KSWARM_', 'INTENT_BROKER_']);
    for (const name of SIDECAR_ENV_NAMES) {
      expect(name).not.toMatch(/[\*?\[\]{}]/);
      expect(secrets).not.toContain(name);
    }
  });
  it('matches Windows names and prefixes without changing original keys', () => {
    const parent = { Path: 'path', SYSTEMROOT: 'root', appdata: 'app', kswarm_foo: 'config', gh_token: 'secret' };
    expect(buildSidecarEnv(parent, 'win32')).toEqual({ Path: 'path', SYSTEMROOT: 'root', appdata: 'app', kswarm_foo: 'config' });
    expect(buildSidecarEnv(parent, 'linux')).toEqual({ Path: 'path', SYSTEMROOT: 'root' });
  });
  it('omits undefined and does not mutate its parent', () => {
    const parent = { PATH: undefined, KSWARM_FOO: undefined, HOME: 'home' };
    expect(buildSidecarEnv(parent)).toEqual({ HOME: 'home' });
    expect(parent).toHaveProperty('PATH', undefined);
  });
});

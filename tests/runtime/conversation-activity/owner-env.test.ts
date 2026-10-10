import { it, expect, vi } from 'vitest';
import { buildActivityOwnerEnv, ensureConversationActivityOwner } from '../../../src/runtime/conversation-activity/owner-launcher.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const secrets = { GH_TOKEN: 'ghp_FAKE', GITHUB_TOKEN: 'ghp_FAKE', NPM_TOKEN: 'ghp_FAKE', NODE_AUTH_TOKEN: 'ghp_FAKE', ANTHROPIC_API_KEY: 'sk-FAKE', OPENAI_API_KEY: 'sk-FAKE', MOONSHOT_API_KEY: 'sk-FAKE', AWS_SECRET_ACCESS_KEY: 'sk-FAKE', XIAOK_TYPESAFE_API_KEY: 'sk-FAKE' };
it('whitelists environment including Windows and excludes sensitive values', () => {
  const allowed = { PATH: 'fake', LC_ALL: 'fake', XIAOK_ACTIVITY_OWNER_IDLE_MS: '1500', SystemRoot: 'fake', HTTPS_PROXY: 'fake' };
  expect(buildActivityOwnerEnv({ ...secrets, ...allowed }, 'win32')).toEqual(allowed);
  expect(JSON.stringify(buildActivityOwnerEnv({ ...secrets, ...allowed }))).not.toMatch(/ghp_FAKE|sk-FAKE/);
});
it('passes filtered environment to injected spawn', async () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-env-'));
  const previous = Object.fromEntries(Object.keys(secrets).map(name => [name, process.env[name]]));
  Object.assign(process.env, secrets);
  const spawn = vi.fn((..._args: any[]) => { throw new Error('fake_spawn'); });
  try {
    await expect(ensureConversationActivityOwner({ schemaVersion: 1, dataRoot: root, profileId: 'fake', actorId: 'fake', identity: { kind: 'cli', path: root } }, { spawn: spawn as any })).rejects.toThrow('fake_spawn');
    for (const name of Object.keys(secrets)) expect(spawn.mock.calls[0]?.[2]?.env).not.toHaveProperty(name);
    expect(JSON.stringify(spawn.mock.calls[0]?.[2]?.env)).not.toMatch(/ghp_FAKE|sk-FAKE/);
  } finally { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } rmSync(root, { recursive: true, force: true }); }
});
it.skipIf(process.platform !== 'linux')('real owner excludes secrets and exits after idle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'activity-env-process-'));
  const names = ['GH_TOKEN', 'ANTHROPIC_API_KEY', 'XIAOK_ACTIVITY_OWNER_IDLE_MS'];
  const previous = names.map(name => process.env[name]);
  process.env.GH_TOKEN = 'ghp_FAKE_TEST'; process.env.ANTHROPIC_API_KEY = 'sk-FAKE_TEST'; process.env.XIAOK_ACTIVITY_OWNER_IDLE_MS = '1500';
  let pid: number | undefined;
  let client: Awaited<ReturnType<typeof ensureConversationActivityOwner>> | undefined;
  try {
    client = await ensureConversationActivityOwner({ schemaVersion: 1, dataRoot: root, profileId: 'fake', actorId: 'fake', identity: { kind: 'cli', path: root } }, { timeoutMs: 4000, entryPath: join(process.cwd(), '.test-dist/src/runtime/conversation-activity/owner-entry.js') });
    pid = (await client.request<{ pid: number }>('status')).pid;
    const { readFileSync } = await import('node:fs');
    const environment = readFileSync(`/proc/${pid}/environ`, 'utf8');
    expect(environment).not.toMatch(/ghp_FAKE_TEST|sk-FAKE_TEST/);
    client.dispose();
    await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow(), { timeout: 6000 });
    pid = undefined;
  } finally {
    client?.dispose(); if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);

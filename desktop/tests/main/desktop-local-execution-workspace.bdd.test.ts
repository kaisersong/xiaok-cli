// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizationFixture } from '../fixtures/multi-agent-authorization.js';
import type { DesktopWorkspaceUserAccess } from '../../electron/desktop-multi-agent-service.js';

describe('fixed local Chat/Goal workspace display has no execution authority', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it('without a thread, the actual factory getter returns only its cwd without a SQLite write or permission change', async () => {
    const f = await authorizationFixture(cleanup), prior = await f.getAuthorization();
    const writes = f.db.prepare('SELECT total_changes() AS n').get();
    expect(f.db.prepare('SELECT count(*) AS n FROM groups').get()).toMatchObject({ n: 0 });
    for (let count = 0; count < 3; count++) expect(await f.invoke('getLocalExecutionWorkspace', {})).toEqual({ cwd: f.root });
    expect(await f.getAuthorization()).toEqual(prior);
    expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(writes);
    expect(f.db.prepare('SELECT count(*) AS n FROM groups').get()).toMatchObject({ n: 0 });
  });
  it.each(['cwd', 'workspaceId', 'profileId', 'threadId', 'actor', 'source'])('rejects renderer-supplied %s at the actual registrar', async key => {
    const f = await authorizationFixture(cleanup);
    await expect(f.invoke('getLocalExecutionWorkspace', { [key]: 'untrusted' })).rejects.toThrow(/invalid multi-agent argument/);
  });
  it('rejects foreign or retired viewers and never returns the path through their sender', async () => {
    const f = await authorizationFixture(cleanup), old = f.reload();
    await expect(f.invoke('getLocalExecutionWorkspace', {}, old)).rejects.toThrow(/unauthorized/);
    f.changePrincipal('other-user');
    await expect(f.invoke('getLocalExecutionWorkspace', {})).rejects.toThrow('workspace_user_owner_mismatch');
  });
  it('service rejects copied access and agent/scheduler and becomes unavailable after dispose', async () => {
    const f = await authorizationFixture(cleanup), service = f.boundary.service;
    const access = service.createWorkspaceUserAccess({ requestSource: 'user', actorId: `desktop-user:${f.boundary.profileId}`,
      profileId: f.boundary.profileId, workspaceId: f.boundary.workspaceId });
    const get = (service as unknown as { getExecutionWorkspaceForUser(input: { access: DesktopWorkspaceUserAccess; requestSource: string }): { cwd: string } }).getExecutionWorkspaceForUser;
    expect(get).toBeTypeOf('function');
    for (const source of ['agent', 'scheduler']) expect(() => get.call(service, { access, requestSource: source })).toThrow();
    expect(() => get.call(service, { access: { ...access }, requestSource: 'user' })).toThrow();
    expect(get.call(service, { access, requestSource: 'user' })).toEqual({ cwd: f.root });
    await f.services.disposeMultiAgent();
    expect(() => get.call(service, { access, requestSource: 'user' })).toThrow();
  });
});

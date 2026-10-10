import { describe, expect, it, vi } from 'vitest';
import { activityOwnerConfigDigest, type ActivityOwnerConfig } from '../../../src/runtime/conversation-activity/owner-runtime.js';

// Digest is pure; do not initialize the owner's unrelated SQLite/RPC infrastructure.
vi.mock('../../../src/runtime/conversation-activity/owner-host.js', () => ({ ConversationActivityOwnerHost: class {} }));
vi.mock('../../../src/runtime/conversation-activity/native-identity.js', () => ({ ActivityNativeIdentityRepository: class {} }));
vi.mock('../../../src/runtime/conversation-activity/owner-sources.js', () => ({ ActivityTaskSnapshotReader: class {}, ActivityNativeGroupReader: class {} }));
vi.mock('../../../src/runtime/conversation-activity/owner-mcp.js', () => ({ ActivityOwnerMcp: class {} }));

const config: ActivityOwnerConfig = {
  schemaVersion: 1, dataRoot: '/data', profileId: 'profile', actorId: 'actor',
  identity: { kind: 'desktop', path: '/identity' },
  kswarm: { url: 'http://localhost:4400', mutationToken: 'mutation', brokerUrl: 'http://localhost:4318', roomToken: 'room' },
  managedSources: [{ name: 'kswarm', executable: '/node', entryPath: '/server.js', cwd: '/data',
    env: { KSWARM_RUNTIME_TOKEN: 'runtime', PATH: '/bin' }, healthUrl: 'http://localhost:4400/health', expectedHealth: { ok: true } }],
};
describe('owner configuration digest', () => {
  it('ignores source environment additions, removal and token changes without mutating input', () => {
    const other = structuredClone(config);
    other.managedSources![0].env = { HOME: '/other', KSWARM_RUNTIME_TOKEN: 'changed' };
    expect(activityOwnerConfigDigest(other)).toBe(activityOwnerConfigDigest(config));
    other.managedSources![0].env = {};
    expect(activityOwnerConfigDigest(other)).toBe(activityOwnerConfigDigest(config));
    expect(config.managedSources![0].env.PATH).toBe('/bin');
  });
  it.each(['url', 'mutationToken', 'brokerUrl', 'roomToken'] as const)('covers kswarm %s', key => {
    const other = structuredClone(config); other.kswarm![key] += '-changed';
    expect(activityOwnerConfigDigest(other)).not.toBe(activityOwnerConfigDigest(config));
  });
  it.each(['executable', 'entryPath', 'healthUrl', 'cwd'] as const)('covers source %s', key => {
    const other = structuredClone(config); other.managedSources![0][key] += '-changed';
    expect(activityOwnerConfigDigest(other)).not.toBe(activityOwnerConfigDigest(config));
  });
  it('retains recursive key sorting and other source token coverage', () => {
    const other = structuredClone(config);
    other.managedSources![0].healthHeaders = { token: 'one' };
    const reordered = { ...other, identity: { path: '/identity', kind: 'desktop' as const } };
    expect(activityOwnerConfigDigest(reordered)).toBe(activityOwnerConfigDigest(other));
    const before = activityOwnerConfigDigest(reordered);
    reordered.managedSources![0].healthHeaders = { token: 'two' };
    expect(activityOwnerConfigDigest(reordered)).not.toBe(before);
  });
});

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { WORK_EVENT_SENSITIVITY, WORK_BINDING_SENSITIVITY, WORK_WATCH_SENSITIVITY, ACTIVITY_ORIGIN_SENSITIVITY, WORK_PROJECTION_SENSITIVITY, CONVERSATION_ACTIVITY_SENSITIVITY, projectMetadataOnly } from '../../../src/runtime/conversation-activity/sensitivity.js';

const source = ts.createSourceFile('types.ts', readFileSync('src/runtime/conversation-activity/types.ts', 'utf8'), ts.ScriptTarget.Latest, true);
function keys(name: string): string[] {
  const node = source.statements.find(n => ts.isInterfaceDeclaration(n) && n.name.text === name) as ts.InterfaceDeclaration;
  return [...(node.heritageClauses ?? []).flatMap(c => c.types.flatMap(t => keys(t.expression.getText(source)))), ...node.members.map(m => m.name!.getText(source))];
}
const canary = 'CANARY-secret-内容';
const path = `/private/${canary}`;
describe('field sensitivity', () => {
  it.each([
    ['WorkEvent', WORK_EVENT_SENSITIVITY], ['WorkBinding', WORK_BINDING_SENSITIVITY],
    ['WorkWatch', WORK_WATCH_SENSITIVITY], ['ActivityOrigin', ACTIVITY_ORIGIN_SENSITIVITY],
    ['WorkProjection', WORK_PROJECTION_SENSITIVITY], ['ConversationActivity', CONVERSATION_ACTIVITY_SENSITIVITY],
  ] as const)('covers every actual %s type field', (name, table) => {
    const expected = keys(name);
    if (name === 'ConversationActivity') expected.push(...keys('WorkProjection').map(k => `projection.${k}`));
    if (name === 'WorkWatch') expected.push(...keys('ActivityOrigin').map(k => `origin.${k}`));
    expect(Object.keys(table).sort()).toEqual(expected.sort());
  });
  it('classifies all sensitive paths', () => {
    expect(WORK_EVENT_SENSITIVITY.summary).toBe('content');
    expect(WORK_PROJECTION_SENSITIVITY.summary).toBe('content');
    expect(CONVERSATION_ACTIVITY_SENSITIVITY['projection.summary']).toBe('content');
    expect(WORK_WATCH_SENSITIVITY['origin.workspaceId']).toBe('forbidden');
  });
  it.each(['WorkEvent', 'WorkBinding', 'WorkWatch', 'WorkProjection', 'ConversationActivity', 'ActivityOrigin'] as const)('drops unknown content from %s', kind => {
    const value = { summary: canary, title: canary, taskName: canary, unknown: canary, workspaceId: path,
      watchId: 'watch-1', source: 'mcp', evidenceRefs: ['ref-1'], revision: 7,
      projection: { watchId: 'watch-1', summary: canary, revision: 7, evidenceRefs: ['ref-1'], unknown: canary },
      origin: { profileId: 'profile-1', threadId: 'thread-1', actorId: 'actor-1', workspaceId: path, unknown: canary } };
    const result = projectMetadataOnly(kind, value);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain(path);
    expect(result).not.toHaveProperty('unknown');
    expect(result).not.toHaveProperty('title');
    expect(value.summary).toBe(canary);
    if (kind === 'ConversationActivity') expect(result.projection).toEqual({ watchId: 'watch-1', revision: 7, evidenceRefs: ['ref-1'] });
    if (kind === 'WorkWatch') expect(result.origin).toEqual({ profileId: 'profile-1', threadId: 'thread-1', actorId: 'actor-1' });
  });
  it.each([
    ['WorkEvent', WORK_EVENT_SENSITIVITY], ['WorkBinding', WORK_BINDING_SENSITIVITY],
    ['WorkWatch', WORK_WATCH_SENSITIVITY], ['WorkProjection', WORK_PROJECTION_SENSITIVITY],
    ['ConversationActivity', CONVERSATION_ACTIVITY_SENSITIVITY], ['ActivityOrigin', ACTIVITY_ORIGIN_SENSITIVITY],
  ] as const)('preserves metadata scalars and arrays in %s', (kind, table) => {
    for (const [key, sensitivity] of Object.entries(table)) {
      if (sensitivity !== 'metadata' || key.includes('.') || key === 'projection' || key === 'origin') continue;
      for (const value of ['opaque-id', 42, false, null, ['ref-1', 'ref-2']]) {
        expect(projectMetadataOnly(kind, { [key]: value })).toEqual({ [key]: value });
      }
    }
  });
  it('fails closed on malformed objects, getters and object-valued metadata', () => {
    for (const value of [null, undefined, 7, [], canary]) expect(projectMetadataOnly('WorkEvent', value)).toEqual({});
    const value = { eventId: { secret: canary }, evidenceRefs: [{ secret: canary }] };
    Object.defineProperty(value, 'source', { get() { throw new Error(canary); } });
    expect(projectMetadataOnly('WorkEvent', value)).toEqual({});
  });
});

describe('Room nested metadata projection', () => {
  it('drops human text and paths from every array element', () => {
    const result = projectMetadataOnly('RoomWorkspaceSnapshot', {
      revision: 7, rootDisplayPath: canary,
      instructions: { publishedText: canary, revision: 2 },
      claims: [{ claimId: 'c1', agentName: canary }, { claimId: 'c2', unknown: canary }],
      artifacts: [{ artifactId: 'a1', producerDisplayName: canary, relativePath: path }, { artifactId: 'a2', size: 5, unknown: canary }],
      projectMappings: [{ projectId: 'p1', name: canary }, { projectId: 'p2', rootDisplayPath: path }],
    });
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result).toEqual({ revision: 7, instructions: { revision: 2 }, claims: [{ claimId: 'c1' }, { claimId: 'c2' }], artifacts: [{ artifactId: 'a1' }, { artifactId: 'a2', size: 5 }], projectMappings: [{ projectId: 'p1' }, { projectId: 'p2' }] });
  });
  it('retains discussion logical agent IDs', () => {
    expect(projectMetadataOnly('RoomDiscussionSettled', { completed: ['agent-1'], failed: ['agent-2'] })).toEqual({ completed: ['agent-1'], failed: ['agent-2'] });
  });
});

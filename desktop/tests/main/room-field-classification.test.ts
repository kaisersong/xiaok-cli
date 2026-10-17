// @vitest-environment node
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { CollaborationRoomDispatchEvent } from '../../electron/collaboration-room-wake-dispatcher.js';
import type { RoomWorkspaceSnapshot, RoomWorkspaceArtifact, RoomWorkspaceFilePreview, RoomWorkspaceChangeInput } from '../../shared/room-workspace-contract.js';
import { projectMetadataOnly,
  ROOM_WAKE_SETTLED_SENSITIVITY, type LocalRoomWakeSettled,
  ROOM_DISCUSSION_SETTLED_SENSITIVITY, type LocalRoomDiscussionSettled,
  ROOM_WORKSPACE_CHANGED_SENSITIVITY, type LocalRoomWorkspaceChanged,
  ROOM_WORKSPACE_PERMISSIONS_SENSITIVITY, type LocalRoomWorkspacePermissions,
  ROOM_WORKSPACE_INSTRUCTIONS_SENSITIVITY, type LocalRoomWorkspaceInstructions,
  ROOM_WORKSPACE_CLAIM_SENSITIVITY, type LocalRoomWorkspaceClaim,
  ROOM_WORKSPACE_ARTIFACT_SENSITIVITY, type LocalRoomWorkspaceArtifact,
  ROOM_WORKSPACE_PROJECT_MAPPING_SENSITIVITY, type LocalRoomWorkspaceProjectMapping,
  ROOM_WORKSPACE_SNAPSHOT_SENSITIVITY, type LocalRoomWorkspaceSnapshot,
  ROOM_WORKSPACE_FILE_PREVIEW_SENSITIVITY, type LocalRoomWorkspaceFilePreview,
  ROOM_WORKSPACE_CHANGE_INPUT_SENSITIVITY, type LocalRoomWorkspaceChangeInput,
  ROOM_WORKSPACE_TEMPLATE_ENTRY_SENSITIVITY, type LocalRoomWorkspaceTemplateEntry
} from '../../../src/runtime/conversation-activity/sensitivity.js';
type SameKeys<A, B> = [Exclude<keyof A, keyof B>, Exclude<keyof B, keyof A>] extends [never, never] ? true : false;
type Assert<T extends true> = T;
export type CheckRoomWakeSettled = Assert<SameKeys<LocalRoomWakeSettled, Extract<CollaborationRoomDispatchEvent, { type: 'wake_settled' }>>>;
type ActualRoomWakeSettled = Extract<CollaborationRoomDispatchEvent, { type: 'wake_settled' }>;
export type CheckRoomDiscussionSettled = Assert<SameKeys<LocalRoomDiscussionSettled, Extract<CollaborationRoomDispatchEvent, { type: 'discussion_settled' }>>>;
type ActualRoomDiscussionSettled = Extract<CollaborationRoomDispatchEvent, { type: 'discussion_settled' }>;
export type CheckRoomWorkspaceChanged = Assert<SameKeys<LocalRoomWorkspaceChanged, { type: 'workspace_changed'; kind: 'workspace_changed'; roomId: string }>>;
type ActualRoomWorkspaceChanged = { type: 'workspace_changed'; kind: 'workspace_changed'; roomId: string };
export type CheckRoomWorkspacePermissions = Assert<SameKeys<LocalRoomWorkspacePermissions, RoomWorkspaceSnapshot['permissions']>>;
type ActualRoomWorkspacePermissions = RoomWorkspaceSnapshot['permissions'];
export type CheckRoomWorkspaceInstructions = Assert<SameKeys<LocalRoomWorkspaceInstructions, NonNullable<RoomWorkspaceSnapshot['instructions']>>>;
type ActualRoomWorkspaceInstructions = NonNullable<RoomWorkspaceSnapshot['instructions']>;
export type CheckRoomWorkspaceClaim = Assert<SameKeys<LocalRoomWorkspaceClaim, RoomWorkspaceSnapshot['claims'][number]>>;
type ActualRoomWorkspaceClaim = RoomWorkspaceSnapshot['claims'][number];
export type CheckRoomWorkspaceArtifact = Assert<SameKeys<LocalRoomWorkspaceArtifact, RoomWorkspaceArtifact>>;
type ActualRoomWorkspaceArtifact = RoomWorkspaceArtifact;
export type CheckRoomWorkspaceProjectMapping = Assert<SameKeys<LocalRoomWorkspaceProjectMapping, NonNullable<RoomWorkspaceSnapshot['projectMappings']>[number]>>;
type ActualRoomWorkspaceProjectMapping = NonNullable<RoomWorkspaceSnapshot['projectMappings']>[number];
export type CheckRoomWorkspaceSnapshot = Assert<SameKeys<LocalRoomWorkspaceSnapshot, RoomWorkspaceSnapshot>>;
type ActualRoomWorkspaceSnapshot = RoomWorkspaceSnapshot;
export type CheckRoomWorkspaceFilePreview = Assert<SameKeys<LocalRoomWorkspaceFilePreview, RoomWorkspaceFilePreview>>;
type ActualRoomWorkspaceFilePreview = RoomWorkspaceFilePreview;
export type CheckRoomWorkspaceChangeInput = Assert<SameKeys<LocalRoomWorkspaceChangeInput, RoomWorkspaceChangeInput>>;
type ActualRoomWorkspaceChangeInput = RoomWorkspaceChangeInput;
export type CheckRoomWorkspaceTemplateEntry = Assert<SameKeys<LocalRoomWorkspaceTemplateEntry, RoomWorkspaceChangeInput['templateEntries'][number]>>;
type ActualRoomWorkspaceTemplateEntry = RoomWorkspaceChangeInput['templateEntries'][number];

const root = resolve(process.cwd(), basename(process.cwd()) === 'desktop' ? '..' : '.');
const filename = resolve(root, 'desktop/tests/main/room-field-classification.test.ts');
const options: ts.CompilerOptions = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
const program = ts.createProgram([filename], options);
const checker = program.getTypeChecker();
const source = program.getSourceFile(filename)!;
const canary = 'CANARY-room-secret-内容';
describe('Room field classification contracts', () => {
  it('type-level key equality assertions compile', () => {
    expect(program.getSemanticDiagnostics(source).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  });
  it('rejects a desktop contract field added without classification', () => {
    const contract = resolve(root, 'desktop/shared/room-workspace-contract.ts');
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (resolve(path) === contract) {
        const changed = readFileSync(contract, 'utf8').replace('export interface RoomWorkspaceArtifact {', 'export interface RoomWorkspaceArtifact { unclassifiedCanary?: string;');
        return ts.createSourceFile(path, changed, languageVersion, true);
      }
      return getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
    };
    const changed = ts.createProgram([filename], options, host);
    expect(changed.getSemanticDiagnostics(changed.getSourceFile(filename)!).some(d => d.code === 2344)).toBe(true);
  });
  it.each([
    ['RoomWakeSettled', ROOM_WAKE_SETTLED_SENSITIVITY],
    ['RoomDiscussionSettled', ROOM_DISCUSSION_SETTLED_SENSITIVITY],
    ['RoomWorkspaceChanged', ROOM_WORKSPACE_CHANGED_SENSITIVITY],
    ['RoomWorkspacePermissions', ROOM_WORKSPACE_PERMISSIONS_SENSITIVITY],
    ['RoomWorkspaceInstructions', ROOM_WORKSPACE_INSTRUCTIONS_SENSITIVITY],
    ['RoomWorkspaceClaim', ROOM_WORKSPACE_CLAIM_SENSITIVITY],
    ['RoomWorkspaceArtifact', ROOM_WORKSPACE_ARTIFACT_SENSITIVITY],
    ['RoomWorkspaceProjectMapping', ROOM_WORKSPACE_PROJECT_MAPPING_SENSITIVITY],
    ['RoomWorkspaceSnapshot', ROOM_WORKSPACE_SNAPSHOT_SENSITIVITY],
    ['RoomWorkspaceFilePreview', ROOM_WORKSPACE_FILE_PREVIEW_SENSITIVITY],
    ['RoomWorkspaceChangeInput', ROOM_WORKSPACE_CHANGE_INPUT_SENSITIVITY],
    ['RoomWorkspaceTemplateEntry', ROOM_WORKSPACE_TEMPLATE_ENTRY_SENSITIVITY]
  ] as const)('covers actual %s keys at runtime', (name, table) => {
    const alias = source.statements.find(n => ts.isTypeAliasDeclaration(n) && n.name.text === `Actual${name}`) as ts.TypeAliasDeclaration;
    expect(Object.keys(table).sort()).toEqual(checker.getTypeAtLocation(alias).getProperties().map(p => p.name).sort());
  });
  it('tracks workspace_changed object literals in main', () => {
    const main = ts.createSourceFile('main.ts', readFileSync(resolve(root, 'desktop/electron/main.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    let found = 0;
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node) && node.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(main) === 'type' && ts.isStringLiteral(p.initializer) && p.initializer.text === 'workspace_changed')) {
        found++;
        expect(node.properties.map(p => p.name?.getText(main)).sort()).toEqual(Object.keys(ROOM_WORKSPACE_CHANGED_SENSITIVITY).sort());
      }
      ts.forEachChild(node, visit);
    };
    visit(main);
    expect(found).toBeGreaterThan(0);
  });
  it('projects each nested object and drops canary text, paths and unknown fields', () => {
    const result = projectMetadataOnly('RoomWorkspaceSnapshot', {
      ok: true, code: 'ok', phase: 'active', revision: 9, generation: 2, rootDisplayPath: canary, unknown: canary,
      permissions: { canRead: true, canManage: false, unknown: canary },
      instructions: { revision: 3, publishedText: canary, candidateText: canary, sourceRelativePath: canary, sourceChanged: true, sourceHash: 'hash' },
      claims: [1, 2].map(i => ({ claimId: `claim-${i}`, runId: `run-${i}`, agentName: canary, executionState: 'running', authorizationState: 'allowed', instructionsRevision: 3, unknown: canary })),
      artifacts: [1, 2].map(i => ({ artifactId: `artifact-${i}`, versionId: `version-${i}`, relativePath: canary, producerDisplayName: canary, state: 'current', size: 42, contentHash: 'hash', producerType: 'agent', synchronization: 'synced', unknown: canary })),
      projectMappings: [1, 2].map(i => ({ projectId: `project-${i}`, name: canary, state: 'ready', mappingRevision: 4, projectRevision: 5, workFolderRelativePath: canary, artifactsRelativePath: canary, unknown: canary })),
    });
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(result).toEqual({ ok: true, code: 'ok', phase: 'active', revision: 9, generation: 2,
      permissions: { canRead: true, canManage: false }, instructions: { revision: 3, sourceChanged: true, sourceHash: 'hash' },
      claims: [1, 2].map(i => ({ claimId: `claim-${i}`, runId: `run-${i}`, executionState: 'running', authorizationState: 'allowed', instructionsRevision: 3 })),
      artifacts: [1, 2].map(i => ({ artifactId: `artifact-${i}`, versionId: `version-${i}`, state: 'current', size: 42, contentHash: 'hash', producerType: 'agent', synchronization: 'synced' })),
      projectMappings: [1, 2].map(i => ({ projectId: `project-${i}`, state: 'ready', mappingRevision: 4, projectRevision: 5 })),
    });
  });
  it('preserves dispatch IDs, status and numeric metadata', () => {
    expect(projectMetadataOnly('RoomWakeSettled', { type: 'wake_settled', roomId: 'room-1', roomMessageId: 'msg-1', logicalAgentId: 'agent-1', outcome: 'completed', remaining: 2, unknown: canary })).toEqual({ type: 'wake_settled', roomId: 'room-1', roomMessageId: 'msg-1', logicalAgentId: 'agent-1', outcome: 'completed', remaining: 2 });
    expect(projectMetadataOnly('RoomDiscussionSettled', { completed: ['agent-1', 'agent-2'], failed: ['agent-3'] })).toEqual({ completed: ['agent-1', 'agent-2'], failed: ['agent-3'] });
    expect(projectMetadataOnly('RoomWorkspaceChanged', { type: 'workspace_changed', kind: 'workspace_changed', roomId: 'room-1', unknown: canary })).toEqual({ type: 'workspace_changed', kind: 'workspace_changed', roomId: 'room-1' });
  });
  it('drops preview text and selected paths', () => {
    expect(projectMetadataOnly('RoomWorkspaceFilePreview', { ok: true, text: canary, truncated: false, contentHash: 'hash' })).toEqual({ ok: true, truncated: false, contentHash: 'hash' });
    expect(projectMetadataOnly('RoomWorkspaceChangeInput', { roomId: 'room-1', selectedPath: canary, instructionsText: canary, directoryName: canary, templateEntries: [{ relativePath: canary, kind: 'file', content: canary, unknown: canary }] })).toEqual({ roomId: 'room-1', templateEntries: [{ kind: 'file' }] });
  });
  it('does not invoke nested getters or array serializers', () => {
    const claims = [{ claimId: 'claim-1' }];
    Object.defineProperty(claims[0], 'agentName', { get() { throw new Error(canary); } });
    Object.defineProperty(claims, 'toJSON', { value: () => canary });
    expect(projectMetadataOnly('RoomWorkspaceSnapshot', { claims })).toEqual({ claims: [{ claimId: 'claim-1' }] });
    Object.defineProperty(claims, '0', { get() { throw new Error(canary); } });
    expect(projectMetadataOnly('RoomWorkspaceSnapshot', { claims })).toEqual({});
  });
});

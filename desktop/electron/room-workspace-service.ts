import { randomUUID } from 'node:crypto';
import { createRoomWorkspaceMappingRecovery, type PendingWorkspaceMapping } from './room-workspace-mapping-recovery.js';
import { mkdir, open, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { RoomWorkspaceApi, RoomWorkspaceChangeInput, RoomWorkspaceFileRequest, RoomWorkspaceSnapshot } from '../shared/room-workspace-contract.js';
import { RoomWorkspaceLocalStore, prepareWorkspaceRoot, resolveWorkspacePath, previewWorkspaceTemplate, applyWorkspaceTemplate, listWorkspaceDirectory, observeWorkspaceFile, pathWithin, workspaceDigest, type LocalWorkspaceBinding, type WorkspaceRoot } from './room-workspace-local.js';

export interface RoomWorkspaceBrokerPort {
  get(roomId: string): Promise<Record<string, unknown>>;
  request(roomId: string, action: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}
interface WorkspaceConfig {
  workspaceId: string; activeBindingId: string; originHostId: string; generation: number; revision: number; phase: string;
  operationId?: string; nextGeneration?: number;
}
interface BrokerState {
  ok: boolean; code?: string; config: WorkspaceConfig | null;
  permissions?: { canManage: boolean; canRead: boolean; canRegister?: boolean };
  members?: Array<{ status: string; subject: { kind: string; userId?: string } }>;
  instructions?: RoomWorkspaceSnapshot['instructions']; claims?: RoomWorkspaceSnapshot['claims'];
}
interface PreviewRecord { input: RoomWorkspaceChangeInput; physical: WorkspaceRoot; overlaps: string[] }
const failureCode = (error: unknown) => error instanceof Error ? error.message : 'workspace_unavailable';
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Only Desktop main constructs this service. The semantic IPC wrapper supplies
 * user intent, never identities. Broker transport authenticates every action.
 */
export function createRoomWorkspaceService(options: {
  store: RoomWorkspaceLocalStore; broker: RoomWorkspaceBrokerPort; isMutationOwner: () => boolean;
  ensureProtocol?: () => Promise<void>;
  kswarmRequest?: (path: string, init?: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  getRoomProjects?: (roomId: string) => Promise<Array<Record<string, unknown>>>;
  cancelRoomExecution?: (roomId: string) => Promise<unknown>;
}) {
  const { store, broker } = options;
  const mappingRecovery = options.kswarmRequest ? createRoomWorkspaceMappingRecovery({ store, broker, isMutationOwner: options.isMutationOwner, kswarmRequest: options.kswarmRequest }) : undefined;
  async function state(roomId: string, manage = false): Promise<BrokerState> {
    if (!validId(roomId)) throw new Error('room_input_invalid');
    const result = await broker.get(roomId) as unknown as BrokerState;
    if (!result.ok) throw new Error(result.code ?? 'broker_unavailable');
    if (manage && !result.permissions?.canManage) throw new Error('room_actor_forbidden');
    return result;
  }
  async function mutate(roomId: string, action: string, input: Record<string, unknown>) {
    if (!options.isMutationOwner()) throw new Error('workspace_mutation_owner_busy');
    const result = await broker.request(roomId, action, input);
    if (!result.ok) throw Object.assign(new Error(String(result.code ?? 'broker_unavailable')), { workspaceAuthorityRejected: true });
    return result;
  }
  function activeBinding(config: WorkspaceConfig, roomId: string) {
    const binding = store.getBinding(config.activeBindingId);
    if (!binding || binding.roomId !== roomId || binding.state !== 'active' || binding.workspaceId !== config.workspaceId || binding.generation !== config.generation || binding.hostId !== config.originHostId) throw new Error('workspace_binding_unavailable');
    return binding;
  }
  async function authorizeFile(input: RoomWorkspaceFileRequest, versionId?: string): Promise<LocalWorkspaceBinding> {
    const snapshot = await state(input.roomId);
    if (!snapshot.config) throw new Error('workspace_not_configured');
    const authorization = await broker.request(input.roomId, 'authorize-read', {
      bindingId: input.bindingId, generation: input.generation, contextScope: { kind: 'room_only' },
      relativePath: input.relativePath, ...(versionId ? { versionId } : {}),
    });
    if (!authorization.ok) throw new Error(String(authorization.code ?? 'workspace_read_denied'));
    const binding = store.getBinding(input.bindingId);
    if (!binding || binding.roomId !== input.roomId || binding.generation !== input.generation || binding.hostId !== snapshot.config.originHostId) throw new Error('workspace_binding_unavailable');
    if (input.bindingId !== snapshot.config.activeBindingId && !versionId) throw new Error('workspace_historical_read_denied');
    await resolveWorkspacePath(binding, '');
    return binding;
  }
  async function readText(binding: WorkspaceRoot, relativePath: string, maximum = 262144) {
    const absolute = await resolveWorkspacePath(binding, relativePath);
    const handle = await open(absolute, 'r');
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new Error('workspace_file_required');
      const bytes = Buffer.alloc(Math.min(maximum, before.size));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const after = await handle.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('workspace_file_changed');
      return { text: bytes.subarray(0, bytesRead).toString('utf8'), truncated: before.size > bytesRead };
    } finally { await handle.close(); }
  }
  const api: RoomWorkspaceApi = {
    async retryCollaborationRoomWorkspaceChange(input) {
      try {
        const current = await state(input.roomId, true);
        if (!current.config || current.config.revision !== input.expectedRevision || current.config.operationId !== input.operationId) throw new Error('workspace_revision_conflict');
        const record = store.getRecord<{ previewId: string }>('change-request', workspaceDigest('local-operation', { roomId: input.roomId, requestId: input.operationId }));
        const preview = record && store.getRecord<PreviewRecord>('preview', record.previewId);
        if (!record || !preview) throw new Error('workspace_operation_not_found');
        return api.commitCollaborationRoomWorkspace({ roomId: input.roomId, previewId: record.previewId, expectedRevision: preview.input.expectedRevision, idempotencyKey: input.operationId, confirmOverlap: true, confirmSharedReadGrant: true });
      } catch (error) { return { ok: false, code: failureCode(error) }; }
    },
    async mapCollaborationRoomWorkspaceProject(input) {
      try {
        const snapshot = await state(input.roomId, true);
        if (!snapshot.config || snapshot.config.phase !== 'active') throw new Error('workspace_not_active');
        if (!options.kswarmRequest) throw new Error('workspace_project_unavailable');
        const binding = activeBinding(snapshot.config, input.roomId);
        const workFolder = (await prepareWorkspaceRoot(await resolveWorkspacePath(binding, input.workFolderRelativePath))).canonicalRoot;
        const artifactsDir = (await prepareWorkspaceRoot(await resolveWorkspacePath(binding, input.artifactsRelativePath))).canonicalRoot;
        if (!pathWithin(workFolder, artifactsDir)) throw new Error('workspace_artifacts_outside_workfolder');
        const payload = { projectId: input.projectId, roomId: input.roomId, workspaceId: binding.workspaceId, originHostId: binding.hostId, bindingId: binding.bindingId, generation: binding.generation, expectedProjectRevision: input.expectedProjectRevision, workFolder, artifactsDir, rootIdentity: binding.identity };
        const payloadDigest = workspaceDigest('mapping', payload);
        const recordKey = workspaceDigest('mapping-request', { roomId: input.roomId, projectId: input.projectId, operationId: input.idempotencyKey });
        const prior = store.getRecord<PendingWorkspaceMapping>('pending-mapping', recordKey);
        if (prior?.cancelled || prior?.rejected) throw new Error('workspace_operation_finished');
        if (prior && prior.payloadDigest !== payloadDigest) throw new Error('workspace_idempotency_conflict');
        if (store.listRecords<PendingWorkspaceMapping>('pending-mapping').some(record => record.roomId === input.roomId && record.projectId === input.projectId && record.recordKey !== recordKey && !record.applied && !record.cancelled && !record.rejected)) throw new Error('workspace_mapping_pending');
        const record = prior ?? { recordKey, roomId: input.roomId, projectId: input.projectId, operationId: input.idempotencyKey, payloadDigest, payload, applied: false };
        if (!record.applied) await mappingRecovery!.execute(record, async () => {
          try { await mutate(input.roomId, 'project-fence', { expectedRevision: input.expectedRevision, projectId: input.projectId, operationId: input.idempotencyKey }); }
          catch (error) {
            // A definitive rejection of a first attempt creates no fence. An
            // unknown transport result or a replay stays pending for recovery.
            if (!prior && (error as { workspaceAuthorityRejected?: boolean }).workspaceAuthorityRejected) store.saveRecord('pending-mapping', recordKey, { ...record, cancelled: true });
            throw error;
          }
          const issued = await mutate(input.roomId, 'mapping-ticket', { projectId: input.projectId, operationId: input.idempotencyKey, expectedProjectRevision: input.expectedProjectRevision, payloadDigest });
          return (issued.ticket as { ticketId: string }).ticketId;
        });
        return { ok: true, operationId: input.idempotencyKey, snapshot: await api.getCollaborationRoomWorkspace(input) };
      } catch (error) { return { ok: false, code: failureCode(error) }; }
    },
    async setCollaborationRoomLocalCommands(input) {
      try {
        if(input.requestSource!=='user'||typeof input.enabled!=='boolean')throw new Error('room_actor_forbidden');
        if(!options.isMutationOwner())throw new Error('workspace_mutation_owner_busy');
        const snapshot=await state(input.roomId,true),config=snapshot.config;
        if(!config||config.phase!=='active'||config.activeBindingId!==input.bindingId||config.generation!==input.generation)throw new Error('workspace_binding_mismatch');
        const binding=activeBinding(config,input.roomId);
        await resolveWorkspacePath(binding,'');
        store.saveRecord('local-command-grant',binding.bindingId,{enabled:input.enabled,roomId:input.roomId,generation:input.generation});
        if(!input.enabled)await options.cancelRoomExecution?.(input.roomId);
        return {ok:true,snapshot:await api.getCollaborationRoomWorkspace(input)};
      } catch(error) {return {ok:false,code:failureCode(error)};}
    },
    async getCollaborationRoomWorkspace({ roomId }) {
      try {
        const snapshot = await state(roomId);
        const config = snapshot.config;
        const base: RoomWorkspaceSnapshot = { ok: true, phase: config?.phase ?? 'unconfigured', revision: config?.revision ?? 0, permissions: snapshot.permissions ?? { canManage: false, canRead: false }, claims: (snapshot.claims ?? []).map(claim => ({ ...claim, agentName: typeof (claim as unknown as { taskName?: unknown }).taskName === 'string' ? (claim as unknown as { taskName: string }).taskName : claim.agentName })), artifacts: [], instructions: snapshot.instructions };
        if (!config) return base;
        Object.assign(base, { workspaceId: config.workspaceId, bindingId: config.activeBindingId, generation: config.generation, operationId: config.operationId });
        // Metadata projection cannot bypass the same grant as file browsing.
        if (snapshot.permissions?.canRead) {
          try {
          const binding = await authorizeFile({ roomId, bindingId: config.activeBindingId, generation: config.generation, relativePath: '' });
          base.rootDisplayPath = binding.canonicalRoot;
          base.localCommandsAllowed=store.localCommandsAllowed(binding);
          const artifacts = store.listArtifacts(roomId).filter(item => item.bindingId === binding.bindingId && (item.contextScope as { kind?: string } | undefined)?.kind === 'room_only');
          for (const artifact of artifacts) {
            try { if ((await observeWorkspaceFile(binding, String(artifact.relativePath))).contentHash !== artifact.contentHash) artifact.state = 'changed'; }
            catch (error) { artifact.state = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable'; }
          }
          base.artifacts = artifacts as unknown as RoomWorkspaceSnapshot['artifacts'];
          if (base.instructions?.sourceRelativePath) {
            try {
              const observed = await observeWorkspaceFile(binding, base.instructions.sourceRelativePath);
              base.instructions = { ...base.instructions, sourceChanged: observed.contentHash !== base.instructions.sourceHash };
              if (base.instructions.sourceChanged) {
                const candidate = await readText(binding, base.instructions.sourceRelativePath!);
                if (!candidate.truncated) Object.assign(base.instructions, { candidateText: candidate.text, candidateHash: observed.contentHash });
              }
            } catch { base.instructions = { ...base.instructions, sourceChanged: true }; }
          }
          } catch (error) {
            // A missing disk or binding must not hide the owner's existing
            // change operation. Only the file surface loses availability.
            base.permissions = { ...base.permissions, canRead: false, canRegister: false };
            base.code = failureCode(error);
            base.artifacts = [];
            delete base.rootDisplayPath;
          }
        }
        // Historical metadata is itself protected by an exact-version grant;
        // a current-root grant never confers retired-directory enumeration.
        const visibleVersions = new Set(base.artifacts.map(item => item.versionId));
        for (const artifact of store.listArtifacts(roomId)) {
          if (visibleVersions.has(String(artifact.versionId)) || (artifact.contextScope as { kind?: string } | undefined)?.kind !== 'room_only') continue;
          try {
            const binding = await authorizeFile({ roomId, bindingId: String(artifact.bindingId), generation: Number(artifact.generation), relativePath: String(artifact.relativePath) }, String(artifact.versionId));
            try { if ((await observeWorkspaceFile(binding, String(artifact.relativePath))).contentHash !== artifact.contentHash) artifact.state = 'changed'; }
            catch (error) { artifact.state = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable'; }
            base.artifacts.push(artifact as unknown as RoomWorkspaceSnapshot['artifacts'][number]);
          } catch { /* Not authorized means no path, hash, or version metadata. */ }
        }
        base.permissions.canReadArtifacts = base.artifacts.length > 0;
        const pendingTickets = new Set(store.pendingOutbox().map(event => (event.ticket as { ticketId?: string } | undefined)?.ticketId));
        for (const artifact of base.artifacts) {
          const record = artifact as unknown as { commitTicketId?: string; confirmationTicketId?: string; producerClaimId?: string };
          artifact.synchronization = [record.commitTicketId, record.confirmationTicketId].some(ticket => ticket !== undefined && pendingTickets.has(ticket)) ? 'pending' : 'synced';
          const producer = base.claims.find(claim => claim.claimId === record.producerClaimId);
          if (producer?.agentName) artifact.producerDisplayName = producer.agentName;
        }
        if (options.getRoomProjects) {
          try {
            const projects = await options.getRoomProjects(roomId);
            const binding = store.getBinding(config.activeBindingId);
            base.projectMappings = projects.map(project => {
              const mapping = project.workspaceMapping as Record<string, unknown> | undefined;
              const matched = mapping?.bindingId === config.activeBindingId && mapping?.generation === config.generation;
              const pending = store.listRecords<PendingWorkspaceMapping>('pending-mapping').some(record => record.roomId === roomId && record.projectId === project.id && !record.applied && !record.cancelled && !record.rejected);
              return { projectId: String(project.id), name: String(project.name ?? ''), state: pending ? 'updating' : matched ? String(mapping!.state) : 'mapping_required',
                ...(typeof project.projectRevision === 'number' ? { projectRevision: project.projectRevision } : {}),
                ...(typeof mapping?.mappingRevision === 'number' ? { mappingRevision: mapping.mappingRevision } : {}),
                ...(binding && matched ? { workFolderRelativePath: relative(binding.canonicalRoot, String(mapping!.workFolder)).replace(/\\/g, '/'), artifactsRelativePath: relative(binding.canonicalRoot, String(mapping!.artifactsDir)).replace(/\\/g, '/') } : {}),
              };
            });
          } catch { base.projectMappings = []; }
        }
        return base;
      } catch (error) { return { ok: false, code: failureCode(error), phase: 'unavailable', revision: 0, permissions: { canManage: false, canRead: false }, claims: [], artifacts: [] }; }
    },
    async previewCollaborationRoomWorkspace(input) {
      try {
        const snapshot = await state(input.roomId, true);
        if ((snapshot.config?.revision ?? 0) !== input.expectedRevision) throw new Error('workspace_revision_conflict');
        if (input.mode === 'unset') {
          if (snapshot.config) throw new Error('workspace_unbind_requires_explicit_migration');
          return { ok: true, canCommit: false, changes: [], conflicts: [], overlaps: [] };
        }
        if (!validId(input.selectedPath) || !Array.isArray(input.templateEntries)) throw new Error('workspace_path_invalid');
        const physical = await prepareWorkspaceRoot(input.selectedPath);
        if (input.mode === 'create' && (!validId(input.directoryName) || /[\\/]/.test(input.directoryName) || ['.', '..'].includes(input.directoryName))) throw new Error('workspace_directory_name_invalid');
        const entries = input.templateEntries.map(entry => ({ relativePath: entry.relativePath, kind: entry.kind, ...(entry.content === undefined ? {} : { text: entry.content }) }));
        const targetPath = input.mode === 'create' ? join(physical.canonicalRoot, input.directoryName!) : physical.canonicalRoot;
        if (input.mode === 'create') {
          try { await lstat(targetPath); throw new Error('workspace_directory_exists'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        // Validate relative paths without creating the selected new directory.
        const changes = await previewWorkspaceTemplate(physical, input.mode === 'create' ? entries.map(entry => ({ ...entry, relativePath: join(input.directoryName!, entry.relativePath) })) : entries);
        const conflicts = changes.filter(entry => entry.state === 'conflict').map(entry => entry.relativePath);
        const overlaps = store.listBindings().filter(binding => binding.roomId !== input.roomId && (pathWithin(binding.canonicalRoot, targetPath) || pathWithin(targetPath, binding.canonicalRoot))).map(binding => binding.roomId);
        const previewId = randomUUID(); store.saveRecord('preview', previewId, { input, physical, overlaps });
        return { ok: true, previewId, canCommit: conflicts.length === 0, conflicts, overlaps, changes: changes.map((entry, index) => ({ relativePath: entries[index].relativePath, kind: entry.kind, action: input.mode === 'create' ? 'create' : entry.state === 'exists' ? 'existing' : 'create', ...(entry.text === undefined ? {} : { content: entry.text }) })) };
      } catch (error) { return { ok: false, code: failureCode(error), canCommit: false, changes: [], conflicts: [], overlaps: [] }; }
    },
    async commitCollaborationRoomWorkspace(input) {
      try {
        const preview = store.getRecord<PreviewRecord>('preview', input.previewId);
        if (!preview || preview.input.roomId !== input.roomId || preview.input.expectedRevision !== input.expectedRevision) throw new Error('workspace_preview_expired');
        await state(input.roomId, true);
        const operationKey = workspaceDigest('local-operation', { roomId: input.roomId, requestId: input.idempotencyKey });
        const completed = store.getRecord<{ previewId: string }>('completed-change', operationKey);
        if (completed) {
          if (completed.previewId !== input.previewId) throw new Error('workspace_idempotency_conflict');
          return { ok: true, operationId: input.idempotencyKey, snapshot: await api.getCollaborationRoomWorkspace(input) };
        }
        const previousRequest = store.getRecord<{ previewId: string }>('change-request', operationKey);
        if (previousRequest && previousRequest.previewId !== input.previewId) throw new Error('workspace_idempotency_conflict');
        if (!input.confirmSharedReadGrant || (preview.overlaps.length > 0 && !input.confirmOverlap)) throw new Error('workspace_sharing_confirmation_required');
        if (!validId(input.idempotencyKey)) throw new Error('workspace_request_id_required');
        if (!options.ensureProtocol) throw new Error('workspace_protocol_unavailable');
        await options.ensureProtocol();
        store.saveRecord('change-request', operationKey, { previewId: input.previewId });
        await resolveWorkspacePath(preview.physical, '');
        const changeDigest = workspaceDigest('change', preview.input);
        const begun = await mutate(input.roomId, 'begin-change', { expectedRevision: input.expectedRevision, requestId: input.idempotencyKey, payloadDigest: changeDigest });
        const config = begun.config as WorkspaceConfig;
        const operationId = String(begun.operationId ?? config.operationId);
        const prior = store.listBindings(input.roomId).find(binding => binding.requestId === input.idempotencyKey);
        let physical = prior ?? preview.physical;
        if (preview.input.mode === 'create' && !prior) {
          const target = await resolveWorkspacePath(preview.physical, preview.input.directoryName!, true);
          await mkdir(target); physical = await prepareWorkspaceRoot(target);
        }
        const generation = Number(begun.nextGeneration ?? config.nextGeneration ?? config.generation);
        const binding = store.prepareBinding(prior ? {
          bindingId: prior.bindingId, workspaceId: prior.workspaceId, roomId: prior.roomId, hostId: prior.hostId,
          generation: prior.generation, canonicalRoot: prior.canonicalRoot, identity: prior.identity,
          requestId: prior.requestId, payloadDigest: prior.payloadDigest, createdBy: prior.createdBy,
        } : { ...physical, roomId: input.roomId, workspaceId: config.workspaceId || randomUUID(), hostId: config.originHostId, generation, bindingId: randomUUID(), requestId: input.idempotencyKey, payloadDigest: workspaceDigest('binding', physical), createdBy: 'user.local' });
        const committed = config.activeBindingId === binding.bindingId && ['committed', 'activation_failed', 'active'].includes(config.phase)
          ? { config }
          : await mutate(input.roomId, 'commit-binding', { operationId, expectedRevision: config.revision, workspaceId: binding.workspaceId, bindingId: binding.bindingId, payloadDigest: changeDigest });
        let committedConfig = committed.config as WorkspaceConfig;
        try {
          // Keep admission fenced while applying confirmed template changes.
          // A partial failure preserves all files and stays activation_failed.
          await resolveWorkspacePath(binding, '');
          if (committedConfig.phase !== 'active') await applyWorkspaceTemplate(binding, preview.input.templateEntries.map(entry => ({ relativePath: entry.relativePath, kind: entry.kind, ...(entry.content === undefined ? {} : { text: entry.content }) })));
          if (preview.input.instructionsText) {
            const published = await mutate(input.roomId, 'publish-instructions', { expectedRevision: committedConfig.revision, requestId: `${input.idempotencyKey}:instructions`, publishedText: preview.input.instructionsText, description: '', directoryNotes: '' });
            committedConfig = published.config as WorkspaceConfig;
          }
          store.activateBinding(binding.bindingId, committedConfig);
          await mutate(input.roomId, 'activate-binding', { operationId, expectedRevision: committedConfig.revision });
        } catch (error) {
          store.markActivationFailed(binding.bindingId);
          await mutate(input.roomId, 'activation-failed', { operationId, expectedRevision: committedConfig.revision }).catch(() => undefined);
          throw error;
        }
        const grantMembers = (await state(input.roomId, true)).members?.filter(member => member.status === 'active' && member.subject.kind === 'user' && member.subject.userId) ?? [];
        for (const member of grantMembers) {
          const grantState = await state(input.roomId, true);
          await mutate(input.roomId, 'grant-read', { expectedRevision: grantState.config!.revision, bindingId: binding.bindingId, generation: binding.generation, contextScope: { kind: 'room_only' }, subjectKind: 'user', subjectId: member.subject.userId, allowedPathsOrVersions: [{ kind: 'path', relativePath: '', recursive: true }], requestId: `${input.idempotencyKey}:${member.subject.userId}` });
        }
        store.saveRecord('completed-change', operationKey, { previewId: input.previewId, bindingId: binding.bindingId });
        return { ok: true, operationId, snapshot: await api.getCollaborationRoomWorkspace({ roomId: input.roomId }) };
      } catch (error) { return { ok: false, code: failureCode(error) }; }
    },
    async cancelCollaborationRoomWorkspaceChange(input) {
      try { await state(input.roomId, true); await mutate(input.roomId, 'cancel-change', { operationId: input.operationId, expectedRevision: input.expectedRevision, requestId: input.idempotencyKey }); return { ok: true, snapshot: await api.getCollaborationRoomWorkspace(input) }; }
      catch (error) { return { ok: false, code: failureCode(error) }; }
    },
    async listCollaborationRoomWorkspaceFiles(input) {
      try {
        const binding = await authorizeFile(input);
        const page = await listWorkspaceDirectory(binding, input.relativePath, input.cursor === undefined ? 0 : Number(input.cursor));
        return { ok: true, entries: page.entries.filter(entry => entry.kind !== 'link') as Array<{ name: string; relativePath: string; kind: 'file' | 'directory' }>, ...(page.nextCursor === undefined ? {} : { nextCursor: String(page.nextCursor) }) };
      } catch (error) { return { ok: false, code: failureCode(error), entries: [] }; }
    },
    async previewCollaborationRoomWorkspaceFile(input) {
      try {
        const binding = await authorizeFile(input, input.versionId);
        const observed = await observeWorkspaceFile(binding, input.relativePath);
        if (input.versionId) {
          const version = store.listArtifacts(input.roomId).find(artifact => artifact.versionId === input.versionId && artifact.bindingId === input.bindingId && artifact.relativePath === input.relativePath);
          if (!version) throw new Error('workspace_version_not_found');
          if (version.contentHash !== observed.contentHash) return { ok: true, state: 'changed' };
        }
        const content = await readText(binding, input.relativePath);
        if ((await observeWorkspaceFile(binding, input.relativePath)).contentHash !== observed.contentHash) return { ok: true, state: 'changed' };
        return { ok: true, state: 'current', ...content, contentHash: observed.contentHash, mimeType: 'text/plain' };
      } catch (error) { return { ok: false, code: failureCode(error), ...((error as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'missing' as const } : {}) }; }
    },
    async publishCollaborationRoomWorkspaceInstructions(input) {
      try {
        const snapshot = await state(input.roomId, true);
        if (!snapshot.config) throw new Error('workspace_not_configured');
        const binding = activeBinding(snapshot.config, input.roomId);
        if (input.sourceRelativePath) {
          const observed = await observeWorkspaceFile(binding, input.sourceRelativePath);
          const content = await readText(binding, input.sourceRelativePath);
          if (observed.contentHash !== input.sourceHash || content.truncated || content.text !== input.publishedText) throw new Error('workspace_instructions_source_changed');
        }
        await mutate(input.roomId, 'publish-instructions', { expectedRevision: input.expectedRevision, requestId: input.idempotencyKey, publishedText: input.publishedText, description: '', directoryNotes: '', ...(input.sourceRelativePath ? { sourceRelativePath: input.sourceRelativePath, sourceHash: input.sourceHash } : {}) });
        return { ok: true, snapshot: await api.getCollaborationRoomWorkspace(input) };
      } catch (error) { return { ok: false, code: failureCode(error) }; }
    },
    async registerCollaborationRoomWorkspaceArtifact(input) {
      try {
        const binding = await authorizeFile(input);
        const observed = await observeWorkspaceFile(binding, input.relativePath);
        const subjectKey = `user:user.local:${input.idempotencyKey}`;
        const manifest = { roomId: input.roomId, workspaceId: binding.workspaceId, bindingId: binding.bindingId, generation: binding.generation, contextScope: { kind: 'room_only' }, producerType: 'user', artifacts: [observed] };
        const payloadDigest = workspaceDigest('manifest', manifest);
        store.prepareSubmission({ subjectKey, submissionId: input.idempotencyKey, payloadDigest, manifest });
        const result = await mutate(input.roomId, 'ticket', { actionId: input.idempotencyKey, submissionId: input.idempotencyKey, payloadDigest, contextScope: { kind: 'room_only' }, bindingId: binding.bindingId, generation: binding.generation });
        store.commitSubmission(subjectKey, result.ticket as { ticketId: string; submissionId: string; payloadDigest: string; commitSequence: number });
        await flushOutbox();
        return { ok: true, snapshot: await api.getCollaborationRoomWorkspace(input) };
      } catch (error) { return { ok: false, code: failureCode(error) }; }
    },
    async confirmCollaborationRoomWorkspaceArtifact(input) {
      try {
        await state(input.roomId, true);
        const artifact = store.listArtifacts(input.roomId).find(item => item.artifactId === input.artifactId && item.versionId === input.versionId);
        if (!artifact) throw new Error('workspace_version_not_found');
        const binding = await authorizeFile({ roomId: input.roomId, bindingId: String(artifact.bindingId), generation: Number(artifact.generation), relativePath: String(artifact.relativePath) }, input.versionId);
        if ((await observeWorkspaceFile(binding, String(artifact.relativePath))).contentHash !== artifact.contentHash) throw new Error('workspace_file_changed');
        // A dedicated owner-authorized ticket is required; ordinary user upload
        // tickets never imply formal confirmation authority.
        const payloadDigest = workspaceDigest('confirmation', { artifactId: input.artifactId, versionId: input.versionId });
        const recordKey = workspaceDigest('confirmation-request', { roomId: input.roomId, submissionId: input.idempotencyKey });
        const pending = { recordKey, roomId: input.roomId, artifactId: input.artifactId, versionId: input.versionId, bindingId: artifact.bindingId, generation: artifact.generation, workspaceId: artifact.workspaceId, submissionId: input.idempotencyKey, payloadDigest, committed: false };
        const previous = store.getRecord<typeof pending>('pending-confirmation', recordKey);
        if (previous && (previous.payloadDigest !== payloadDigest || previous.bindingId !== pending.bindingId || previous.generation !== pending.generation)) throw new Error('workspace_idempotency_conflict');
        if (!previous) store.saveRecord('pending-confirmation', recordKey, pending);
        const result = await mutate(input.roomId, 'confirm-artifact', { artifactId: input.artifactId, versionId: input.versionId, bindingId: artifact.bindingId, generation: artifact.generation, expectedRevision: input.expectedRevision, submissionId: input.idempotencyKey, payloadDigest });
        store.confirmArtifact(input.roomId, input.versionId, result.ticket as { ticketId: string; payloadDigest: string; commitSequence: number });
        store.saveRecord('pending-confirmation', recordKey, { ...pending, committed: true });
        await flushOutbox();
        return { ok: true, snapshot: await api.getCollaborationRoomWorkspace(input) };
      } catch (error) { return { ok: false, code: failureCode(error) }; }
    },
  };
  async function flushOutbox() {
    for (const event of store.pendingOutbox()) {
      const manifest = event.manifest as Record<string, unknown>;
      const ticket = event.ticket as Record<string, unknown>;
      try { await mutate(String(manifest.roomId), 'projection', { ticketId: ticket.ticketId, payloadDigest: ticket.payloadDigest, eventKind: event.eventKind }); store.acknowledgeOutbox(event.eventId); } catch { /* durable pending, never false delivery */ }
    }
  }
  return { ...api, flushOutbox, authorizeFile, activeBinding, recoverMappings: () => mappingRecovery?.recover() ?? Promise.resolve([]) };
}

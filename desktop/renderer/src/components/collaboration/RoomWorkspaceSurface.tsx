import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale } from '../../contexts/LocaleContext';
import { getDesktopApi } from '../../shared/desktop';
import { ChatRightSurface } from '../ChatRightSurface';
import { ExpandableCard } from '../ui/expandable-card';
import { ChevronDown, FolderOpen, FolderPlus, SlidersHorizontal } from 'lucide-react';
import type { RoomWorkspaceApi, RoomWorkspaceArtifact, RoomWorkspaceFilePage, RoomWorkspaceFilePreview, RoomWorkspaceMutationResult, RoomWorkspacePreview, RoomWorkspaceSnapshot } from '../../../../shared/room-workspace-contract';
import './room-workspace.css';
const unknownMutationCodes = new Set(['workspace_operation_unknown', 'workspace_mapping_pending', 'workspace_drain_pending', 'workspace_activation_pending', 'broker_unavailable']);

/** A projection of main-owned state. Missing capability is unavailable, never success. */
export function RoomWorkspaceSurface({ roomId, children, refreshToken }: { roomId: string; children: ReactNode; refreshToken?: number }) {
  const { t } = useLocale(); const l = t.roomWorkspace;
  const api = getDesktopApi() as (Partial<RoomWorkspaceApi> & { selectDirectory?: () => Promise<{ filePath: string }>; onCollaborationRoomEvent?: (handler: (event: { roomId: string; kind?: string; type?: string }) => void) => () => void }) | undefined;
  const apiRef = useRef(api); apiRef.current = api;
  const [snapshot, setSnapshot] = useState<RoomWorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [unknownCommit, setUnknownCommit] = useState(false); const [previewRevision, setPreviewRevision] = useState(0);
  const [settings, setSettings] = useState(false); const [mode, setMode] = useState<'existing' | 'create' | 'unset'>('existing');
  const [selectedPath, setPath] = useState(''); const [directoryName, setDirectoryName] = useState(''); const [template, setTemplate] = useState('');
  const [templateFiles, setTemplateFiles] = useState<Array<{ relativePath: string; content: string }>>([]);
  const [preview, setPreview] = useState<RoomWorkspacePreview | null>(null); const [overlap, setOverlap] = useState(false); const [sharedGrant, setSharedGrant] = useState(false);
  const [fileMode, setFileMode] = useState<'directory' | 'registered'>('directory'); const [directory, setDirectory] = useState('');
  const [files, setFiles] = useState<RoomWorkspaceFilePage | null>(null); const [filePreview, setFilePreview] = useState<RoomWorkspaceFilePreview | null>(null);
  const [instructions, setInstructions] = useState(''); const [sourcePath, setSourcePath] = useState('');
  const [instructionMode, setInstructionMode] = useState<'inline' | 'file'>('inline');
  const [sourcePreview, setSourcePreview] = useState<RoomWorkspaceFilePreview | null>(null);
  const instructionDraft = useRef<{ dirty: boolean; revision: number }>({ dirty: false, revision: 0 });
  const [mapping, setMapping] = useState<{ projectId: string; expectedRevision: number; expectedProjectRevision: number; workFolderRelativePath: string; artifactsRelativePath: string } | null>(null);
  const [request, setRequest] = useState<{ view: 'files' | 'instructions'; requestId: number }>();
  const epoch = useRef(0); const filesEpoch = useRef(0); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; filesEpoch.current++; }; }, []);
  const denied = !snapshot?.ok || Boolean(snapshot.bindingId && !snapshot.permissions.canRead);
  const canReadArtifacts = Boolean(snapshot?.ok && (snapshot.permissions.canRead || snapshot.permissions.canReadArtifacts === true));
  const visibleFileMode = denied ? 'registered' : fileMode;
  const canManage = Boolean(!loading && !unknownCommit && snapshot?.ok && snapshot.permissions.canManage && !['offline', 'unauthorized'].includes(snapshot.phase));
  const canRegister = Boolean(!loading && !unknownCommit && snapshot?.ok && snapshot.permissions.canRegister && !['offline', 'unauthorized'].includes(snapshot.phase));
  const load = useCallback(async (discardDraft = false) => {
    const token = ++epoch.current; filesEpoch.current++; setLoading(true); setError('');
    try {
      if (!apiRef.current?.getCollaborationRoomWorkspace) throw new Error('unavailable');
      const next = await apiRef.current.getCollaborationRoomWorkspace({ roomId });
      if (!alive.current || token !== epoch.current) return;
      setSnapshot(next); setUnknownCommit(false); setPreview(null);
      if (!next.ok || !next.permissions.canRead) { setFiles(null); setFilePreview(null); setPreview(null); setSettings(false); }
      if (discardDraft || !instructionDraft.current.dirty || !next.ok || !next.permissions.canRead) {
        instructionDraft.current = { dirty: false, revision: next.revision };
        setInstructions(next.instructions?.publishedText ?? ''); setSourcePath(next.instructions?.sourceRelativePath ?? '');
        setInstructionMode(next.instructions?.sourceRelativePath ? 'file' : 'inline'); setSourcePreview(null);
      }
    } catch { if (alive.current && token === epoch.current) { setSnapshot(null); setFiles(null); setFilePreview(null); setError('unavailable'); } }
    finally { if (alive.current && token === epoch.current) setLoading(false); }
  }, [roomId]);
  useEffect(() => { void load(); }, [load, refreshToken]);
  useEffect(() => apiRef.current?.onCollaborationRoomEvent?.(event => { if (event.roomId === roomId && (event.kind === 'workspace_changed' || event.type === 'workspace_changed')) void load(); }), [load, roomId]);
  const mutate = async (action: () => Promise<RoomWorkspaceMutationResult>, registration = false) => {
    if (busy || !(registration ? canRegister : canManage)) return; setBusy(true); setError('');
    try { const result = await action(); if (!alive.current) return; if (!result.ok) { const unknown = unknownMutationCodes.has(result.code ?? '') || /timeout|timed.?out/i.test(result.code ?? ''); setError(unknown ? 'unknown' : result.code ?? 'error'); setUnknownCommit(unknown); setPreview(null); return; } setSettings(false); setPreview(null); await load(true); }
    catch { if (alive.current) { setError('unknown'); setUnknownCommit(true); } }
    finally { if (alive.current) setBusy(false); }
  };
  const browse = async (relativePath = directory, cursor?: string) => {
    if (loading || denied || !snapshot?.bindingId || snapshot.generation === undefined) return;
    const token = ++filesEpoch.current; setFilePreview(null); setError('');
    try {
      if (!apiRef.current?.listCollaborationRoomWorkspaceFiles) throw new Error('unavailable');
      const result = await apiRef.current.listCollaborationRoomWorkspaceFiles({ roomId, bindingId: snapshot.bindingId, generation: snapshot.generation, relativePath, cursor });
      if (!alive.current || token !== filesEpoch.current) return;
      setDirectory(relativePath); setFiles(result.ok ? result : null); if (!result.ok) setError(result.code ?? 'error');
    } catch { if (alive.current && token === filesEpoch.current) { setFiles(null); setError('unavailable'); } }
  };
  const previewFile = async (relativePath: string, artifact?: RoomWorkspaceArtifact) => {
    if (loading || !snapshot || (artifact ? !canReadArtifacts : denied || !snapshot.bindingId || snapshot.generation === undefined)) return;
    const token = ++filesEpoch.current; setFilePreview(null);
    try {
      if (!apiRef.current?.previewCollaborationRoomWorkspaceFile) throw new Error('unavailable');
      const result = await apiRef.current.previewCollaborationRoomWorkspaceFile({ roomId, bindingId: artifact?.bindingId ?? snapshot.bindingId!, generation: artifact?.generation ?? snapshot.generation!, relativePath, ...(artifact ? { versionId: artifact.versionId } : {}) });
      if (alive.current && token === filesEpoch.current) { setFilePreview(result); if (!result.ok) setError(result.code ?? 'error'); }
    } catch { if (alive.current && token === filesEpoch.current) setError('unavailable'); }
  };
  const previewChange = async () => {
    if (!canManage || busy || !snapshot) return;
    if (mode === 'unset') { setSettings(false); return; }
    setBusy(true); setError('');
    try {
      if (!apiRef.current?.previewCollaborationRoomWorkspace) throw new Error('unavailable');
      const result = await apiRef.current.previewCollaborationRoomWorkspace({ roomId, expectedRevision: snapshot.revision, mode, selectedPath, ...(mode === 'create' ? { directoryName } : {}),
        templateEntries: [...template.split('\n').flatMap(line => { const relativePath = line.trim(); return relativePath ? [{ relativePath, kind: 'directory' as const }] : []; }), ...templateFiles.map(file => ({ ...file, kind: 'file' as const }))] });
      if (!alive.current) return; setPreviewRevision(snapshot.revision); setPreview(result); if (!result.ok) setError(result.code ?? 'error'); setOverlap(false); setSharedGrant(false);
    } catch { if (alive.current) setError('unavailable'); }
    finally { if (alive.current) setBusy(false); }
  };
  const readSource = async () => {
    if (loading || denied || !snapshot?.bindingId || snapshot.generation === undefined) return;
    const token = ++filesEpoch.current; setSourcePreview(null);
    try {
      if (!apiRef.current?.previewCollaborationRoomWorkspaceFile) throw new Error('unavailable');
      const result = await apiRef.current.previewCollaborationRoomWorkspaceFile({ roomId, bindingId: snapshot.bindingId, generation: snapshot.generation, relativePath: sourcePath });
      if (alive.current && token === filesEpoch.current) { setSourcePreview(result); if (!result.ok) setError(result.code ?? 'error'); }
    } catch { if (alive.current && token === filesEpoch.current) setError('unavailable'); }
  };
  const openSettings = () => { setSettings(true); setPreview(null); setRequest(old => ({ view: 'files', requestId: (old?.requestId ?? 0) + 1 })); };
  const failureText = error === 'unknown' ? l.operationPending : /permission|unauthor|denied|revoked/.test(error) ? l.permissionDenied : error === 'unavailable' ? l.unavailable : l.error;
  const settingContent = <section className="room-workspace-section" aria-label={l.settings}>
    <h3 className="room-workspace-heading"><SlidersHorizontal size={17} aria-hidden="true" />{l.settings}</h3>
    <fieldset className="room-workspace-form" disabled={busy}>
    {!preview ? <>
      <fieldset className="room-workspace-modes" disabled={busy}><legend>{l.root}</legend>{(['existing', 'create', ...(snapshot?.bindingId ? [] : ['unset'])] as Array<typeof mode>).map(value => <label key={value}><input type="radio" name={`workspace-mode-${roomId}`} checked={mode === value} onChange={() => setMode(value)} /><span>{l[value]}</span></label>)}</fieldset>
      {mode !== 'unset' ? <><div className="room-workspace-directory-card"><FolderOpen size={22} aria-hidden="true" /><div><p className="room-workspace-path">{selectedPath || l.selectDirectory}</p><button disabled={busy} type="button" onClick={() => { void apiRef.current?.selectDirectory?.().then(result => { if (alive.current && result.filePath) setPath(result.filePath); }).catch(() => setError('unavailable')); }}>{l.selectDirectory}</button></div></div>
        {mode === 'create' ? <label>{l.directoryName}<input value={directoryName} onChange={event => setDirectoryName(event.target.value)} /></label> : null}
        <ExpandableCard className="room-workspace-template" disabled={busy} header={<><span><FolderPlus size={16} aria-hidden="true" />{l.template}</span><ChevronDown className="room-workspace-chevron" size={16} aria-hidden="true" /></>}>
        <p className="room-workspace-hint">{l.templateHelp}</p><label>{l.template}<textarea rows={3} value={template} onChange={event => setTemplate(event.target.value)} /></label>
        {templateFiles.map((file, index) => <div key={index}><label>{l.relativePath}<input value={file.relativePath} onChange={event => setTemplateFiles(rows => rows.map((row, i) => i === index ? { ...row, relativePath: event.target.value } : row))} /></label><label>{l.fileContent}<textarea value={file.content} onChange={event => setTemplateFiles(rows => rows.map((row, i) => i === index ? { ...row, content: event.target.value } : row))} /></label><button type="button" onClick={() => setTemplateFiles(rows => rows.filter((_, i) => i !== index))}>{l.remove}</button></div>)}
        <button type="button" onClick={() => setTemplateFiles(rows => [...rows, { relativePath: '', content: '' }])}>{l.addTemplateFile}</button>
        </ExpandableCard>
      </> : <p>{l.noWorkspace}</p>}
      <button className="room-workspace-primary" type="button" disabled={busy || mode !== 'unset' && (!selectedPath || mode === 'create' && !directoryName.trim())} onClick={() => void previewChange()}>{l.preview}</button>
    </> : <>
      <p className="room-workspace-path">{l.root}: {selectedPath}</p>
      {mode === 'create' ? <p>{l.directoryName}: {directoryName}</p> : null}
      {preview.changes.map((change, i) => <div key={i}><code>{change.relativePath}</code>{change.content !== undefined ? <pre>{change.content}</pre> : null}</div>)}
      {preview.conflicts.length > 0 ? <div role="alert"><p>{l.conflicts}</p>{preview.conflicts.map(path => <p key={path}>{path}</p>)}</div> : null}
      {preview.overlaps.length > 0 ? <><p>{l.overlap}</p>{preview.overlaps.map(path => <p key={path}>{path}</p>)}<label><input type="checkbox" checked={overlap} onChange={event => setOverlap(event.target.checked)} />{l.acknowledgeOverlap}</label></> : null}
      <label><input type="checkbox" checked={sharedGrant} onChange={event => setSharedGrant(event.target.checked)} />{l.sharedReadGrant}</label>
      <button className="room-workspace-primary" type="button" disabled={busy || !preview.ok || !preview.canCommit || !preview.previewId || preview.conflicts.length > 0 || !sharedGrant || preview.overlaps.length > 0 && !overlap} onClick={() => void mutate(() => apiRef.current!.commitCollaborationRoomWorkspace!({ roomId, previewId: preview.previewId!, expectedRevision: previewRevision, idempotencyKey: crypto.randomUUID(), confirmOverlap: overlap, confirmSharedReadGrant: sharedGrant }))}>{l.confirm}</button>
    </>}
    <button className="room-workspace-cancel" disabled={busy} type="button" onClick={() => { setSettings(false); setPreview(null); }}>{l.cancel}</button>
    </fieldset>
  </section>;
  const filesContent = <div className="room-workspace-content">
    {settings && canManage ? settingContent : null}
    {!snapshot?.bindingId && !snapshot?.artifacts.length ? !settings ? <p>{l.noWorkspace}</p> : null : !denied || canReadArtifacts ? <>
      <div className="room-workspace-actions">{!denied && snapshot?.permissions.canRead ? <button type="button" aria-pressed={visibleFileMode === 'directory'} onClick={() => { setFileMode('directory'); void browse(); }}>{l.directory}</button> : null}<button type="button" aria-pressed={visibleFileMode === 'registered'} onClick={() => { setFileMode('registered'); setFilePreview(null); }}>{l.registered}</button></div>
      {visibleFileMode === 'directory' ? <section aria-label={l.directory}>
        <p className="room-workspace-path">{directory}</p>
        {directory ? <button type="button" onClick={() => { const normalized = directory.replace(/\\/g, '/'); void browse(normalized.substring(0, Math.max(0, normalized.lastIndexOf('/')))); }}>{l.parentDirectory}</button> : null}
        {!files ? <button type="button" onClick={() => void browse()}>{l.refresh}</button> : files.entries.length === 0 ? <p>{l.empty}</p> : files.entries.map(file => <div key={file.relativePath} className="room-workspace-file"><button type="button" onClick={() => file.kind === 'directory' ? void browse(file.relativePath) : void previewFile(file.relativePath)}>{file.name}</button>{file.kind === 'file' && canRegister ? <button disabled={busy} type="button" aria-label={`${l.registerArtifact} ${file.name}`} onClick={() => void mutate(() => apiRef.current!.registerCollaborationRoomWorkspaceArtifact!({ roomId, bindingId: snapshot.bindingId!, generation: snapshot.generation!, relativePath: file.relativePath, expectedRevision: snapshot.revision, idempotencyKey: crypto.randomUUID() }), true)}>{l.registerArtifact}</button> : null}</div>)}
        {files?.nextCursor ? <button type="button" onClick={() => void browse(directory, files.nextCursor)}>{l.nextPage}</button> : null}
      </section> : <section aria-label={l.registered}>{snapshot.artifacts.length === 0 ? <p>{l.empty}</p> : snapshot.artifacts.map(artifact => <article className="room-workspace-section" key={`${artifact.artifactId}:${artifact.versionId}`}>
        <button type="button" onClick={() => void previewFile(artifact.relativePath, artifact)}>{artifact.relativePath}</button><p>{l.artifactStates[artifact.state] ?? l.unavailable}</p><p>{l.shortVersion(artifact.versionId.slice(0, 8))}</p><p>{l.producer}: {artifact.producerDisplayName || (artifact.producerType === 'user' ? l.userAuthor : artifact.producerType === 'agent' ? l.agentAuthor : l.unknownAuthor)}</p>
        <details><summary>{l.technicalDetails}</summary><p>{artifact.versionId}</p>{artifact.producerRunId ? <p>{artifact.producerRunId}</p> : null}</details>
        {artifact.projectId ? <p>{l.artifactStates.project}</p> : artifact.state === 'draft' && canManage ? <button disabled={busy} type="button" onClick={() => void mutate(() => apiRef.current!.confirmCollaborationRoomWorkspaceArtifact!({ roomId, artifactId: artifact.artifactId, versionId: artifact.versionId, expectedRevision: snapshot.revision, idempotencyKey: crypto.randomUUID() }))}>{l.confirmArtifact}</button> : null}
        {artifact.synchronization === 'pending' ? <p>{l.pendingSync}</p> : null}
      </article>)}</section>}
      {filePreview ? <section aria-label={l.preview}>{!filePreview.ok || filePreview.state === 'changed' || filePreview.state === 'missing' ? <p>{l.oldContent}</p> : <><pre className="room-workspace-preview">{filePreview.text}</pre>{filePreview.truncated ? <p>{l.previewIncomplete}</p> : null}</>}</section> : null}
    </> : <p>{l.permissionDenied}</p>}
    <p className="room-workspace-hint">{l.noSandbox}</p>
  </div>;
  const instructionsContent = <div className="room-workspace-content">
    {!denied ? <><p>{l.version(snapshot?.instructions?.revision ?? 0)}</p>{!snapshot?.instructions?.sourceChanged ? <pre>{snapshot?.instructions?.publishedText || l.empty}</pre> : null}
      {snapshot?.instructions?.sourceChanged ? <section><p>{l.sourceChanged}</p><h4>{l.sourceBefore}</h4><pre>{snapshot.instructions.publishedText}</pre><h4>{l.sourceAfter}</h4><pre>{snapshot.instructions.candidateText}</pre></section> : null}
      {canManage ? <><fieldset><label><input type="radio" name={`instructions-${roomId}`} checked={instructionMode === 'inline'} onChange={() => { instructionDraft.current.dirty = true; setInstructionMode('inline'); }} />{l.inlineInstructions}</label><label><input type="radio" name={`instructions-${roomId}`} checked={instructionMode === 'file'} onChange={() => { instructionDraft.current.dirty = true; setInstructionMode('file'); }} />{l.fileInstructions}</label></fieldset>
        {instructionMode === 'inline' ? <label>{l.published}<textarea value={instructions} onChange={event => { instructionDraft.current.dirty = true; setInstructions(event.target.value); }} /></label> : <><label>{l.sourceFile}<input value={sourcePath} onChange={event => { instructionDraft.current.dirty = true; filesEpoch.current++; setSourcePath(event.target.value); setSourcePreview(null); }} /></label><button type="button" disabled={!sourcePath || busy} onClick={() => void readSource()}>{l.readSource}</button>{sourcePreview?.ok ? <><pre>{sourcePreview.text}</pre>{sourcePreview.truncated ? <p>{l.previewIncomplete}</p> : null}</> : null}</>}
        <button disabled={busy || instructionMode === 'file' && (!sourcePreview?.ok || sourcePreview.truncated || !sourcePreview.contentHash || sourcePreview.text === undefined || sourcePreview.state === 'changed' || sourcePreview.state === 'missing')} type="button" onClick={() => void mutate(() => apiRef.current!.publishCollaborationRoomWorkspaceInstructions!({ roomId, expectedRevision: instructionDraft.current.revision, idempotencyKey: crypto.randomUUID(), publishedText: instructionMode === 'file' ? sourcePreview!.text! : instructions, ...(instructionMode === 'file' ? { sourceRelativePath: sourcePath, sourceHash: sourcePreview!.contentHash } : {}) }))}>{l.publish}</button></> : <p>{l.readOnly}</p>}
    </> : <p>{l.permissionDenied}</p>}
  </div>;
  const taskContent = <div className="room-workspace-content">{!denied ? <>
    {snapshot!.claims.length === 0 ? <p>{l.noTasks}</p> : snapshot!.claims.map(claim => <section key={claim.claimId} className="room-workspace-section"><h3>{claim.agentName ?? claim.runId}</h3><p>{l.phases[claim.executionState] ?? l.unavailable} · {l.phases[claim.authorizationState] ?? l.unavailable}</p><p>{l.version(claim.instructionsRevision)}</p>{snapshot!.instructions && claim.instructionsRevision < snapshot!.instructions.revision ? <p>{l.oldRules}</p> : null}<code>{claim.executorInstanceId}</code></section>)}
    {snapshot!.projectMappings?.map(project => <section key={project.projectId} className="room-workspace-section"><p>{project.name ?? project.projectId}: {l.phases[project.state] ?? l.unavailable}</p>{canManage ? <button type="button" disabled={busy || project.projectRevision === undefined || snapshot!.phase !== 'active' || project.state === 'updating'} onClick={() => setMapping({ projectId: project.projectId, expectedRevision: snapshot!.revision, expectedProjectRevision: project.projectRevision!, workFolderRelativePath: project.workFolderRelativePath ?? '', artifactsRelativePath: project.artifactsRelativePath ?? '' })}>{l.mapProject}</button> : null}</section>)}
    {mapping && canManage ? <section className="room-workspace-section"><h3>{l.mapProject}</h3><p>{l.mappingHint}</p><p>{l.mappingSharedHint}</p><label>{l.workFolder}<input value={mapping.workFolderRelativePath} onChange={event => setMapping({ ...mapping, workFolderRelativePath: event.target.value })} /></label><label>{l.artifactsFolder}<input value={mapping.artifactsRelativePath} onChange={event => setMapping({ ...mapping, artifactsRelativePath: event.target.value })} /></label><button disabled={busy} type="button" onClick={() => void mutate(async () => { const result = await apiRef.current!.mapCollaborationRoomWorkspaceProject!({ roomId, ...mapping, idempotencyKey: crypto.randomUUID() }); if (result.ok) setMapping(null); return result; })}>{l.confirm}</button><button type="button" disabled={busy} onClick={() => setMapping(null)}>{l.cancel}</button></section> : null}
  </> : null}
    {snapshot?.phase === 'draining' && snapshot.operationId && canManage ? <button disabled={busy} type="button" onClick={() => void mutate(() => apiRef.current!.cancelCollaborationRoomWorkspaceChange!({ roomId, operationId: snapshot.operationId!, expectedRevision: snapshot.revision, idempotencyKey: crypto.randomUUID() }))}>{l.cancelChange}</button> : null}
    {snapshot?.phase === 'activation_failed' && snapshot.operationId && canManage ? <button disabled={busy} type="button" onClick={() => void mutate(() => apiRef.current!.retryCollaborationRoomWorkspaceChange!({ roomId, operationId: snapshot.operationId!, expectedRevision: snapshot.revision, idempotencyKey: crypto.randomUUID() }))}>{l.retryChange}</button> : null}
  </div>;
  return <div className="room-workspace-host">
    <div className="room-workspace-bar"><span title={!denied ? snapshot?.rootDisplayPath : undefined}>{l.root}: {!denied ? snapshot?.rootDisplayPath ?? l.phases.unbound : l.unavailable}</span>{!denied && snapshot?.instructions ? <span>{l.version(snapshot.instructions.revision)}</span> : null}
      <span role="status">{loading ? l.loading : snapshot ? l.phases[snapshot.phase] ?? l.unavailable : l.unavailable}</span>
      {canManage ? <button type="button" disabled={busy || !['active', 'unconfigured', 'unbound'].includes(snapshot!.phase)} onClick={openSettings}>{l.settings}</button> : null}<button type="button" onClick={() => void load(true)}>{l.retry}</button>
    </div>
    {!loading && snapshot && denied ? <div role="alert">{snapshot.phase === 'unauthorized' || /permission|denied|revoked/.test(snapshot.code ?? '') ? l.permissionDenied : l.unavailable}</div> : null}
    {error ? <div role="alert">{failureText}</div> : null}
    <div className="room-workspace-body"><ChatRightSurface threadId={`room-${roomId}`} agentCount={0} agentsContent={null} taskContent={taskContent} filesContent={filesContent} instructionsContent={instructionsContent} viewRequest={request} canvasOpen={false} canvasRequestId={0} canvasExpanded={false}>{children}</ChatRightSurface></div>
  </div>;
}

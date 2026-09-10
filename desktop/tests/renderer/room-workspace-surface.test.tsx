import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RoomWorkspaceApi, RoomWorkspaceSnapshot } from '../../shared/room-workspace-contract';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { StrictMode } from 'react';
import { RoomWorkspaceSurface } from '../../renderer/src/components/collaboration/RoomWorkspaceSurface';
const { bridge } = vi.hoisted(() => ({ bridge: {} as Record<string, any> }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => bridge }));
const snapshot = (extra: Partial<RoomWorkspaceSnapshot> = {}): RoomWorkspaceSnapshot => ({ ok: true, phase: 'unbound', revision: 3, permissions: { canManage: true, canRead: true }, claims: [], artifacts: [], ...extra });
beforeEach(() => {
  delete bridge.setCollaborationRoomLocalCommands;
  bridge.getCollaborationRoomWorkspace = vi.fn().mockResolvedValue(snapshot());
  bridge.previewCollaborationRoomWorkspace = vi.fn().mockResolvedValue({ ok: true, previewId: 'preview-1', canCommit: true, changes: [{ relativePath: 'my files', kind: 'directory', action: 'create' }], conflicts: [], overlaps: [] });
  bridge.commitCollaborationRoomWorkspace = vi.fn().mockResolvedValue({ ok: true });
  bridge.selectDirectory = vi.fn().mockResolvedValue({ filePath: '/workspace' });
  bridge.listCollaborationRoomWorkspaceFiles = vi.fn().mockResolvedValue({ ok: true, entries: [{ name: 'draft.md', relativePath: 'draft.md', kind: 'file' }] });
  bridge.previewCollaborationRoomWorkspaceFile = vi.fn().mockResolvedValue({ ok: true, text: 'real preview bytes', state: 'current' });
  bridge.publishCollaborationRoomWorkspaceInstructions = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('ResizeObserver', class { constructor(private cb: any) {} observe() { this.cb([{ contentRect: { width: 1200 } }]); } disconnect() {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });
function mount(roomId = 'r1') { return render(<LocaleProvider><RoomWorkspaceSurface roomId={roomId}><main><textarea aria-label="message" /></main></RoomWorkspaceSurface></LocaleProvider>); }
async function settings() { fireEvent.click(await screen.findByRole('button', { name: '工作区设置' })); }
describe('Room workspace real component interaction', () => {
  it('shows per-room local command consent in settings and sends only the current binding',async()=>{
    let allowed=false;
    bridge.getCollaborationRoomWorkspace=vi.fn(async()=>snapshot({phase:'active',bindingId:'b',generation:1,localCommandsAllowed:allowed}));
    bridge.setCollaborationRoomLocalCommands=vi.fn(async(input:any)=>{allowed=input.enabled;return {ok:true};});
    mount();await settings();
    const checkbox=screen.getByRole('checkbox',{name:'允许本机命令执行'});
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(/命令拥有当前电脑账户的权限/)).toBeVisible();
    fireEvent.click(checkbox);
    await waitFor(()=>expect(bridge.setCollaborationRoomLocalCommands).toHaveBeenCalledWith({roomId:'r1',bindingId:'b',generation:1,enabled:true,requestSource:'user'}));
    await waitFor(()=>expect(screen.getByRole('checkbox',{name:'允许本机命令执行'})).toBeChecked());
  });
  it('keeps a failed instruction draft across explicit refresh and workspace events', async () => {
    let listener!: (event: any) => void;
    bridge.onCollaborationRoomEvent = vi.fn(handler => { listener = handler; return () => {}; });
    bridge.publishCollaborationRoomWorkspaceInstructions.mockResolvedValue({ ok: false, code: 'room_revision_conflict' });
    mount(); await screen.findByRole('button', { name: '工作区设置' });
    fireEvent.click(screen.getByRole('tab', { name: '工作说明' }));
    fireEvent.change(screen.getByLabelText('编辑说明'), { target: { value: 'keep my instruction' } });
    fireEvent.click(screen.getByRole('button', { name: '发布新版本' }));
    await screen.findByRole('alert');
    listener({ roomId: 'r1', kind: 'workspace_changed' });
    await waitFor(() => expect(screen.getByLabelText('编辑说明')).toHaveValue('keep my instruction'));
    expect(screen.getByRole('alert')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(screen.getByLabelText('编辑说明')).toHaveValue('keep my instruction'));
  });
  it('shows the published version and location only after a matching authoritative snapshot', async () => {
    bridge.publishCollaborationRoomWorkspaceInstructions.mockResolvedValue({ ok: true, snapshot: snapshot({ revision: 4, instructions: { revision: 1, publishedText: 'saved instruction' } }) });
    mount(); await screen.findByRole('button', { name: '工作区设置' });
    fireEvent.click(screen.getByRole('tab', { name: '工作说明' }));
    fireEvent.change(screen.getByLabelText('编辑说明'), { target: { value: 'saved instruction' } });
    fireEvent.click(screen.getByRole('button', { name: '发布新版本' }));
    expect(await screen.findByText('工作说明已发布（版本 1）')).toBeVisible();
    expect(screen.getByText('说明保存在本协作空间的“工作说明”中，供后续协作任务使用。')).toBeVisible();
    expect(screen.getAllByText('saved instruction').some(node => node.tagName === 'PRE')).toBe(true);
    expect(screen.getByLabelText('编辑说明')).toHaveValue('saved instruction');
  });
  it('does not discard a draft or report success for an unconfirmed publish snapshot', async () => {
    bridge.publishCollaborationRoomWorkspaceInstructions.mockResolvedValue({ ok: true, snapshot: snapshot() });
    mount(); await screen.findByRole('button', { name: '工作区设置' });
    fireEvent.click(screen.getByRole('tab', { name: '工作说明' }));
    fireEvent.change(screen.getByLabelText('编辑说明'), { target: { value: 'unconfirmed instruction' } });
    fireEvent.click(screen.getByRole('button', { name: '发布新版本' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(screen.getByLabelText('编辑说明')).toHaveValue('unconfirmed instruction'));
    expect(screen.queryByText(/工作说明已发布/)).toBeNull();
  });
  it('keeps optional templates collapsed and preserves the draft across keyboard toggles', async () => {
    mount(); await settings();
    const templateToggle = screen.getByRole('button', { name: '自定义目录模板' });
    expect(templateToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('自定义目录模板')).not.toBeInTheDocument();
    fireEvent.keyDown(templateToggle, { key: 'Enter' });
    fireEvent.change(await screen.findByLabelText('自定义目录模板'), { target: { value: 'drafts' } });
    fireEvent.click(screen.getByRole('button', { name: '添加模板文件' }));
    fireEvent.change(screen.getByLabelText('相对路径'), { target: { value: 'draft.md' } });
    fireEvent.keyDown(templateToggle, { key: ' ' });
    await waitFor(() => expect(screen.queryByLabelText('自定义目录模板')).not.toBeInTheDocument());
    fireEvent.click(templateToggle);
    expect(await screen.findByLabelText('自定义目录模板')).toHaveValue('drafts');
    expect(screen.getByLabelText('相对路径')).toHaveValue('draft.md');
    expect(bridge.commitCollaborationRoomWorkspace).not.toHaveBeenCalled();
  });
  it('freezes template edits while a preview is pending', async () => {
    bridge.previewCollaborationRoomWorkspace.mockReturnValue(new Promise(() => {}));
    mount(); await settings();
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '预览变更' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '自定义目录模板' }));
    fireEvent.click(screen.getByRole('button', { name: '添加模板文件' }));
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(screen.getByLabelText('自定义目录模板')).toBeDisabled();
    expect(screen.getByLabelText('相对路径')).toBeDisabled();
    expect(screen.getByRole('button', { name: '添加模板文件' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '移除建议项' })).toBeDisabled();
  });
  it('shows readable artifact authors and short versions with technical identifiers collapsed', async () => {
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'active', artifacts: [{ artifactId: 'a', versionId: '0123456789abcdef0123456789abcdef', producerRunId: 'run-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', producerDisplayName: '文案助手', producerType: 'agent', bindingId: 'b', generation: 1, relativePath: '文案.md', state: 'draft' }] }));
    mount(); await screen.findByRole('button', { name: '工作区设置' }); fireEvent.click(screen.getByRole('tab', { name: '文件' })); fireEvent.click(screen.getByRole('button', { name: '已登记成果' }));
    expect(screen.getByText('作者 / 来源任务: 文案助手')).toBeVisible();
    expect(screen.getByText('版本 01234567')).toBeVisible();
    expect(screen.getByText('0123456789abcdef0123456789abcdef')).not.toBeVisible();
    expect(screen.getByText('run-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).not.toBeVisible();
    fireEvent.click(screen.getByText('技术详情'));
    expect(screen.getByText('0123456789abcdef0123456789abcdef')).toBeVisible();
    expect(screen.getByText('run-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBeVisible();
  });
  it('permits an individually authorized historical version without granting root browsing', async () => {
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'new-root', generation: 2, phase: 'active', permissions: { canManage: false, canRead: false, canReadArtifacts: true }, artifacts: [{ artifactId: 'old-artifact', versionId: 'old-version', bindingId: 'old-root', generation: 1, relativePath: 'old.txt', state: 'draft' }] }));
    mount(); fireEvent.click(await screen.findByRole('tab', { name: '文件' }));
    fireEvent.click(await screen.findByRole('button', { name: '已登记成果' }));
    fireEvent.click(await screen.findByRole('button', { name: 'old.txt' }));
    await screen.findByText('real preview bytes');
    expect(bridge.previewCollaborationRoomWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({ bindingId: 'old-root', generation: 1, versionId: 'old-version' }));
    expect(screen.queryByRole('button', { name: '目录浏览' })).not.toBeInTheDocument();
    expect(bridge.listCollaborationRoomWorkspaceFiles).not.toHaveBeenCalled();
  });
  it('survives the real application StrictMode effect replay', async () => {
    render(<StrictMode><LocaleProvider><RoomWorkspaceSurface roomId="strict"><main>conversation</main></RoomWorkspaceSurface></LocaleProvider></StrictMode>);
    expect(await screen.findByRole('button', { name: '工作区设置' })).toBeVisible();
  });
  it('an unconfigured room can be set up before any file read grant exists', async () => {
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ phase: 'unconfigured', permissions: { canRead: false, canManage: true } }));
    mount(); await settings(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择目录' })).toBeVisible();
  });
  it('owner retries the same failed activation operation even before a file grant exists', async () => {
    bridge.retryCollaborationRoomWorkspaceChange = vi.fn().mockResolvedValue({ ok: true });
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 2, phase: 'activation_failed', operationId: 'operation-old', permissions: { canRead: false, canManage: true } }));
    mount(); fireEvent.click(await screen.findByRole('button', { name: '重试原绑定变更' }));
    await waitFor(() => expect(bridge.retryCollaborationRoomWorkspaceChange).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'r1', operationId: 'operation-old', expectedRevision: 3 })));
    expect(bridge.commitCollaborationRoomWorkspace).not.toHaveBeenCalled(); expect(bridge.previewCollaborationRoomWorkspace).not.toHaveBeenCalled();
  });
  it.each(['workspace_operation_unknown', 'workspace_mapping_pending', 'workspace_drain_pending', 'workspace_activation_pending', 'broker_unavailable'])('blocks another mutation until an authoritative reload after %s', async code => {
    bridge.publishCollaborationRoomWorkspaceInstructions.mockResolvedValue({ ok: false, code });
    mount(); await screen.findByRole('button', { name: '工作区设置' }); fireEvent.click(screen.getByRole('tab', { name: '工作说明' }));
    fireEvent.change(screen.getByLabelText('编辑说明'), { target: { value: 'new rule' } }); fireEvent.click(screen.getByRole('button', { name: '发布新版本' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作回执未确认');
    expect(screen.queryByRole('button', { name: '发布新版本' })).not.toBeInTheDocument(); expect(bridge.publishCollaborationRoomWorkspaceInstructions).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重新读取' })); await screen.findByRole('button', { name: '工作区设置' });
    expect(bridge.publishCollaborationRoomWorkspaceInstructions).toHaveBeenCalledTimes(1);
  });
  it('previews and cancels without committing or creating a directory', async () => {
    mount(); await settings(); fireEvent.click(screen.getByLabelText('新建目录'));
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }));
    await waitFor(() => expect(bridge.selectDirectory).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('新目录名称'), { target: { value: '共同工作' } });
    fireEvent.click(screen.getByRole('button', { name: '自定义目录模板' }));
    fireEvent.change(screen.getByLabelText('自定义目录模板'), { target: { value: 'my files\n资料' } });
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    await screen.findByRole('button', { name: '确认变更' });
    expect(bridge.previewCollaborationRoomWorkspace).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'r1', expectedRevision: 3, directoryName: '共同工作', templateEntries: [{ relativePath: 'my files', kind: 'directory' }, { relativePath: '资料', kind: 'directory' }] }));
    fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(bridge.commitCollaborationRoomWorkspace).not.toHaveBeenCalled();
  });
  it('requires explicit sharing grant and overlap acknowledgement before commit', async () => {
    bridge.previewCollaborationRoomWorkspace.mockResolvedValue({ ok: true, previewId: 'p', canCommit: true, changes: [], conflicts: [], overlaps: ['another room'] });
    mount(); await settings(); fireEvent.click(screen.getByRole('button', { name: '选择目录' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '预览变更' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    const confirm = await screen.findByRole('button', { name: '确认变更' }); expect(confirm).toBeDisabled();
    expect(screen.getByText('工作目录: /workspace')).toBeVisible();
    fireEvent.click(screen.getByLabelText('我确认共享这些文件，目录重叠不提供隔离'));
    expect(confirm).toBeDisabled(); fireEvent.click(screen.getByLabelText('允许当前空间成员读取此工作目录的共享文件'));
    fireEvent.click(confirm);
    await waitFor(() => expect(bridge.commitCollaborationRoomWorkspace).toHaveBeenCalledWith(expect.objectContaining({ confirmOverlap: true, confirmSharedReadGrant: true, previewId: 'p', expectedRevision: 3 })));
  });
  it('does not offer unset for an existing binding or commit conflicting previews', async () => {
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'active' }));
    bridge.previewCollaborationRoomWorkspace.mockResolvedValue({ ok: true, previewId: 'p', canCommit: false, changes: [], conflicts: ['existing.md'], overlaps: [] });
    mount(); await settings(); expect(screen.queryByLabelText('暂不设置')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '选择目录' })); await waitFor(() => expect(screen.getByRole('button', { name: '预览变更' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(await screen.findByText('existing.md')).toBeVisible(); expect(screen.getByRole('button', { name: '确认变更' })).toBeDisabled();
  });
  it('browses directory separately from registered artifacts with a single surface', async () => {
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'active', artifacts: [{ artifactId: 'a', versionId: 'v', bindingId: 'b', generation: 1, relativePath: 'approved.md', state: 'changed' }] }));
    mount(); await screen.findByRole('button', { name: '工作区设置' }); fireEvent.click(screen.getByRole('tab', { name: '文件' }));
    fireEvent.click(screen.getByRole('button', { name: '目录浏览' }));
    fireEvent.click(await screen.findByRole('button', { name: 'draft.md' })); expect(await screen.findByText('real preview bytes')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '已登记成果' })); expect(screen.getByText('approved.md')).toBeVisible(); expect(screen.getByText('文件已变化')).toBeVisible();
    expect(screen.getAllByTestId('chat-right-panel')).toHaveLength(1); expect(document.querySelectorAll('.chat-right-entry')).toHaveLength(1);
  });
  it('denies file reads after authority fails rather than keeping cached sensitive rows', async () => {
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ ok: false, code: 'permission_denied', phase: 'unauthorized', permissions: { canManage: false, canRead: false } }));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('无权读取或修改此工作区');
    expect(bridge.listCollaborationRoomWorkspaceFiles).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: '工作区设置' })).not.toBeInTheDocument();
  });
  it('publishes full instructions only on explicit confirmation, not source observation', async () => {
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'active', instructions: { revision: 2, publishedText: 'old published', sourceRelativePath: 'guide.md', sourceChanged: true, candidateText: 'new file', candidateHash: 'h' } }));
    mount(); await screen.findByRole('button', { name: '工作区设置' }); fireEvent.click(screen.getByRole('tab', { name: '工作说明' }));
    expect(screen.getAllByText('old published').find(node => node.tagName === 'PRE')).toBeVisible(); expect(screen.getByText('new file')).toBeVisible(); expect(bridge.publishCollaborationRoomWorkspaceInstructions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('直接填写说明'));
    fireEvent.change(screen.getByLabelText('编辑说明'), { target: { value: 'complete edited instruction' } });
    fireEvent.click(screen.getByRole('button', { name: '发布新版本' }));
    await waitFor(() => expect(bridge.publishCollaborationRoomWorkspaceInstructions).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'r1', expectedRevision: 3, publishedText: 'complete edited instruction' })));
  });
  it('requires a full source-file preview and observed hash before publishing file instructions', async () => {
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'active' }));
    bridge.previewCollaborationRoomWorkspaceFile.mockResolvedValue({ ok: true, state: 'current', text: 'file rule', contentHash: 'observed-hash' });
    mount(); await screen.findByRole('button', { name: '工作区设置' }); fireEvent.click(screen.getByRole('tab', { name: '工作说明' }));
    fireEvent.click(screen.getByLabelText('关联说明文件')); fireEvent.change(screen.getByLabelText('说明来源文件（相对路径）'), { target: { value: 'custom/guide.md' } });
    expect(screen.getByRole('button', { name: '发布新版本' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '读取来源文件并比较' })); await screen.findByText('file rule');
    fireEvent.click(screen.getByRole('button', { name: '发布新版本' }));
    await waitFor(() => expect(bridge.publishCollaborationRoomWorkspaceInstructions).toHaveBeenCalledWith(expect.objectContaining({ publishedText: 'file rule', sourceRelativePath: 'custom/guide.md', sourceHash: 'observed-hash' })));
  });
  it('discarded file response cannot repopulate a revoked workspace', async () => {
    let finish!: (value: any) => void;
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'active' }));
    bridge.listCollaborationRoomWorkspaceFiles.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount(); await screen.findByRole('button', { name: '工作区设置' }); fireEvent.click(screen.getByRole('tab', { name: '文件' })); fireEvent.click(screen.getByRole('button', { name: '目录浏览' }));
    await waitFor(() => expect(finish).toBeDefined());
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ ok: false, phase: 'unauthorized', permissions: { canRead: false, canManage: false } }));
    fireEvent.click(screen.getByRole('button', { name: '重新读取' })); await screen.findByRole('alert');
    finish({ ok: true, entries: [{ name: 'private.txt', relativePath: 'private.txt', kind: 'file' }] });
    await waitFor(() => expect(screen.queryByText('private.txt')).not.toBeInTheDocument());
  });
  it('maps a project to root without inventing a directory and preserves both CAS revisions', async () => {
    bridge.mapCollaborationRoomWorkspaceProject = vi.fn().mockResolvedValue({ ok: true });
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'active', projectMappings: [{ projectId: 'project-1', projectRevision: 8, name: 'Launch', state: 'mapping_required' }] }));
    mount(); fireEvent.click(await screen.findByRole('button', { name: '映射项目目录' }));
    fireEvent.click(screen.getByRole('button', { name: '确认变更' }));
    await waitFor(() => expect(bridge.mapCollaborationRoomWorkspaceProject).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'r1', projectId: 'project-1', expectedRevision: 3, expectedProjectRevision: 8, workFolderRelativePath: '', artifactsRelativePath: '' })));
    expect(bridge.previewCollaborationRoomWorkspace).not.toHaveBeenCalled();
  });
  it('does not start another root or project change while the authoritative operation is pending', async () => {
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'draining', operationId: 'old' }));
    const view = mount(); expect(await screen.findByRole('button', { name: '工作区设置' })).toBeDisabled();
    view.unmount(); bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'active', projectMappings: [{ projectId: 'p', projectRevision: 2, state: 'updating' }] }));
    mount(); expect(await screen.findByRole('button', { name: '映射项目目录' })).toBeDisabled();
  });
  it('member registration needs its explicit capability and never enables owner confirmation', async () => {
    bridge.registerCollaborationRoomWorkspaceArtifact = vi.fn().mockResolvedValue({ ok: true });
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'active', permissions: { canManage: false, canRead: true, canRegister: true } }));
    mount(); await screen.findByText('暂无工作区执行任务'); fireEvent.click(screen.getByRole('tab', { name: '文件' })); fireEvent.click(screen.getByRole('button', { name: '目录浏览' }));
    fireEvent.click(await screen.findByRole('button', { name: '登记文件 draft.md' }));
    await waitFor(() => expect(bridge.registerCollaborationRoomWorkspaceArtifact).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: '工作区设置' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '确认此版本' })).not.toBeInTheDocument();
  });
  it('workspace events refresh authority without polling or overwriting an unpublished instruction draft', async () => {
    let listener!: (event: any) => void;
    bridge.onCollaborationRoomEvent = vi.fn(handler => { listener = handler; return () => {}; });
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ bindingId: 'b', generation: 1, phase: 'active', instructions: { revision: 2, publishedText: 'old' } }));
    mount(); await screen.findByRole('button', { name: '工作区设置' }); fireEvent.click(screen.getByRole('tab', { name: '工作说明' }));
    fireEvent.change(screen.getByLabelText('编辑说明'), { target: { value: 'unsaved draft' } });
    bridge.getCollaborationRoomWorkspace.mockResolvedValue(snapshot({ revision: 4, bindingId: 'b', generation: 1, phase: 'active', instructions: { revision: 3, publishedText: 'new remote' } }));
    listener({ roomId: 'r1', kind: 'workspace_changed' });
    await screen.findByText('new remote'); expect(screen.getByLabelText('编辑说明')).toHaveValue('unsaved draft');
    fireEvent.click(screen.getByRole('button', { name: '发布新版本' }));
    await waitFor(() => expect(bridge.publishCollaborationRoomWorkspaceInstructions).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3, publishedText: 'unsaved draft' })));
  });
});

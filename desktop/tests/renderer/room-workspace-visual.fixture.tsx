/** Browser fixture: production UI, deterministic semantic bridge, no user filesystem. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RoomWorkspaceSurface } from '../../renderer/src/components/collaboration/RoomWorkspaceSurface';
import { LocaleProvider as ActualLocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import '../../renderer/src/styles/index.css';
const LocaleProvider = ({ children }: { children: React.ReactNode }) => <React.StrictMode><ActualLocaleProvider>{children}</ActualLocaleProvider></React.StrictMode>;
const calls: unknown[] = [];
const state = { ok: true, phase: 'active', revision: 3, permissions: { canManage: true, canRead: true }, bindingId: 'b', generation: 1, rootDisplayPath: '/shared/共同工作',
  instructions: { revision: 2, publishedText: 'Published working agreement.\n'.repeat(30) }, claims: [{ claimId: 'c', runId: 'run', agentName: 'Pisces', executionState: 'running', authorizationState: 'valid', instructionsRevision: 1 }], artifacts: [] };
(window as any).__workspaceCalls = calls;
(window as any).xiaokDesktop = {
  getCollaborationRoomWorkspace: async () => state,
  selectDirectory: async () => ({ filePath: '/shared/共同工作' }),
  previewCollaborationRoomWorkspace: async (input: unknown) => { calls.push(input); return { ok: true, canCommit: true, previewId: 'p', changes: [{ relativePath: '自定义资料', kind: 'directory', action: 'create' }], conflicts: [], overlaps: [] }; },
  commitCollaborationRoomWorkspace: async (input: unknown) => { calls.push(input); return { ok: true }; },
  listCollaborationRoomWorkspaceFiles: async () => ({ ok: true, entries: Array.from({ length: 40 }, (_, i) => ({ name: `文件 ${i}.md`, relativePath: `文件 ${i}.md`, kind: 'file' })) }),
  previewCollaborationRoomWorkspaceFile: async () => ({ ok: true, text: 'Observed file content', state: 'current' }),
};
document.body.style.margin = '0';
createRoot(document.getElementById('root')!).render(<LocaleProvider><div style={{ height: '100vh', background: 'var(--c-bg-page)' }}><RoomWorkspaceSurface roomId="visual-room"><main style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: 16 }}><h1>Workspace conversation</h1><div data-testid="visual-message-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{Array.from({ length: 80 }, (_, i) => <p key={i}>Message {i}: shared work stays in one conversation.</p>)}</div><textarea aria-label="message draft" defaultValue="Draft remains" /></main></RoomWorkspaceSurface></div></LocaleProvider>);

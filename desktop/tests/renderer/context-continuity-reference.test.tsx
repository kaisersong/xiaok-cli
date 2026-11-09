import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { CopyContextReferenceButton, ContextReferenceCard } from '../../renderer/src/components/ContextReference';
const state = vi.hoisted(() => ({ desktop: null as Record<string, unknown> | null }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => state.desktop }));
afterEach(() => { cleanup(); state.desktop = null; vi.unstubAllGlobals(); });
it('copies a main-issued fixed reference using its current revision and immutable source coordinate', async () => {
  const writeText = vi.fn(async () => {}); vi.stubGlobal('navigator', { clipboard: { writeText } });
  const createContextReference = vi.fn(async () => ({ url: `xiaok://context/v1/${'a'.repeat(32)}` }));
  state.desktop = { getContextConversation: vi.fn(async () => ({ revision: 7 })), createContextReference };
  render(<LocaleProvider><CopyContextReferenceButton conversationId="source" sourceMessage={{ sourceId: 'task_real', sourceMessageId: 'assistant:event:3' }} /></LocaleProvider>);
  fireEvent.click(screen.getByRole('button', { name: '复制消息引用' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`xiaok://context/v1/${'a'.repeat(32)}`));
  expect(createContextReference).toHaveBeenCalledWith({ conversationId: 'source', expectedRevision: 7, operationId: expect.any(String), sourceMessage: { sourceId: 'task_real', sourceMessageId: 'assistant:event:3' } });
});
it('does not grant access merely by rendering or expanding a link; attachment is a separate user action', async () => {
  const attachContextReference = vi.fn(async () => ({ grantId: 'grant' }));
  state.desktop = { getContextGrant: vi.fn(async () => null), attachContextReference, resolveContextReference: vi.fn(async () => ({ refId: 'a'.repeat(32), conversationId: 'source', snapshotRevision: 7, messages: [{ messageId: 'm', revision: 1, text: 'historical text', sourceId: 'task_real', sourceMessageId: 'user' }] })) };
  render(<LocaleProvider><ContextReferenceCard url={`xiaok://context/v1/${'a'.repeat(32)}`} targetConversationId="target" /></LocaleProvider>);
  expect(attachContextReference).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '展开引用' }));
  await screen.findByText('historical text'); expect(attachContextReference).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: '前往原消息' })).toHaveAttribute('href', expect.stringContaining('/t/source'));
  fireEvent.click(screen.getByRole('button', { name: '允许当前会话读取' }));
  await waitFor(() => expect(attachContextReference).toHaveBeenCalledWith({ refId: 'a'.repeat(32), targetConversationId: 'target', operationId: expect.any(String) }));
});
it('can preserve an existing search grant as explicit user authorization without revoking the consumed grant first',async()=>{
 let basis='history_search';const attachContextReference=vi.fn(async()=>{basis='explicit';return {grantId:'managed-grant'};}),revokeContextGrant=vi.fn();
 state.desktop={getContextGrant:vi.fn(async()=>({grantId:'managed-grant',basis})),attachContextReference,revokeContextGrant,resolveContextReference:vi.fn()};
 render(<LocaleProvider><ContextReferenceCard url={`xiaok://context/v1/${'a'.repeat(32)}`} targetConversationId="target"/></LocaleProvider>);
 const keep=await screen.findByRole('button',{name:'保留此引用授权'});fireEvent.click(keep);
 await waitFor(()=>expect(attachContextReference).toHaveBeenCalledWith({refId:'a'.repeat(32),targetConversationId:'target',operationId:expect.any(String)}));
 expect(revokeContextGrant).not.toHaveBeenCalled();await waitFor(()=>expect(screen.queryByRole('button',{name:'保留此引用授权'})).not.toBeInTheDocument());
});
it('opens a taskless CLI archive at its exact readonly reference and avoids a self link on that landing',async()=>{
 const refId='a'.repeat(32);state.desktop={getContextGrant:vi.fn(async()=>null),resolveContextReference:vi.fn(async()=>({refId,conversationId:'taskless-archive',snapshotRevision:2,messages:[{messageId:'second',revision:1,text:'CLI_EXACT_SOURCE',sourceId:'cli_archive_real',sourceMessageId:'legacy_1',sourceKind:'cli_session',visibilityBasis:'user_claimed_archive',executionState:'unknown'}]}))};
 const rendered=render(<LocaleProvider><ContextReferenceCard url={`xiaok://context/v1/${refId}`} targetConversationId="target"/></LocaleProvider>);fireEvent.click(screen.getByRole('button',{name:'展开引用'}));await screen.findByText('CLI_EXACT_SOURCE');expect(screen.getByRole('link',{name:'前往原消息'})).toHaveAttribute('href',`#/context/${refId}`);
 rendered.rerender(<LocaleProvider><ContextReferenceCard url={`xiaok://context/v1/${refId}`}/></LocaleProvider>);fireEvent.click(screen.getByRole('button',{name:'展开引用'}));await screen.findByText('CLI_EXACT_SOURCE');expect(screen.queryByRole('link',{name:'前往原消息'})).not.toBeInTheDocument();
});

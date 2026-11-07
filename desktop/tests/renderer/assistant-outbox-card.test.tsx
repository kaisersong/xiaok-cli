import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {AssistantOutboxCard} from '../../renderer/src/components/assistant/AssistantOutboxCard';
import {assistantInboxZh} from '../../renderer/src/locales/assistant-inbox';
vi.mock('../../renderer/src/contexts/LocaleContext',()=>({useLocale:()=>({t:{assistantInbox:assistantInboxZh}})}));
afterEach(cleanup);
const draft={id:'10000000-1111-4111-8111-111111111111',revision:1,channel:'mail' as const,recipient:'you@example.com',to:['you@example.com'],subject:'Review',text:'Original text',status:'draft' as const,createdAt:100};
it('shows complete recipients and editable body and only sends on an explicit click',()=>{const approve=vi.fn();render(<AssistantOutboxCard draft={draft} busy={false} onApprove={approve} onRefuse={vi.fn()}/>);expect(screen.getByLabelText('收件人')).toHaveValue('you@example.com');expect(approve).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('完整正文'),{target:{value:'Reviewed and edited'}});fireEvent.click(screen.getByRole('button',{name:'确认并发送'}));expect(approve).toHaveBeenCalledWith(expect.objectContaining({id:draft.id,expectedRevision:1,text:'Reviewed and edited',to:['you@example.com']}));});
it('never offers automatic retry for an uncertain delivery',()=>{render(<AssistantOutboxCard draft={{...draft,status:'unknown'}} busy={false} onApprove={vi.fn()} onRefuse={vi.fn()}/>);expect(screen.queryByRole('button',{name:'确认并发送'})).not.toBeInTheDocument();expect(screen.getByText(assistantInboxZh.unknownSend)).toBeInTheDocument();});

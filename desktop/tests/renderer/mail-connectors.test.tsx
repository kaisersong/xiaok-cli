import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { MailConnectors } from '../../renderer/src/components/settings/MailConnectors';
import {zh} from '../../renderer/src/locales/zh';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
const h=vi.hoisted(()=>({list:vi.fn(),connect:vi.fn(),remove:vi.fn(),test:vi.fn(),search:vi.fn(),read:vi.fn(),oauth:vi.fn(),start:vi.fn(),cancel:vi.fn(),access:vi.fn()}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>({getMailAccounts:h.list,connectMailAccount:h.connect,disconnectMailAccount:h.remove,testMailAccount:h.test,searchMailMessages:h.search,readMailMessage:h.read,getMailOAuthState:h.oauth,startMailOAuth:h.start,cancelMailOAuth:h.cancel,setMailAccountAccess:h.access})}));
const account={id:'a'.repeat(32),provider:'qq',email:'example@qq.com',host:'imap.qq.com',port:993,allowSend:true,revision:1,status:'saved'};
beforeEach(()=>{localStorage.setItem('xiaok:locale','zh');for(const f of Object.values(h))f.mockReset();h.list.mockResolvedValue([]);h.oauth.mockResolvedValue({phase:'idle'});});afterEach(cleanup);
const page=()=>render(<LocaleProvider><MailConnectors /></LocaleProvider>);
const openConnector=async(name:string)=>{const button=await screen.findByRole('button',{name});await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);};
it('shows five email connectors and searches the catalogue without connecting anything',async()=>{page();await screen.findByRole('button',{name:'添加 QQ 邮箱'});expect(screen.getByRole('button',{name:'添加 163 邮箱'})).toBeVisible();expect(screen.getByRole('button',{name:'添加 Gmail'})).toBeVisible();fireEvent.change(screen.getByRole('searchbox',{name:'搜索邮箱连接器'}),{target:{value:'163'}});expect(screen.queryByRole('button',{name:'添加 QQ 邮箱'})).toBeNull();expect(h.connect).not.toHaveBeenCalled();});
it('tests and connects QQ only after submitting its visible form, and never stores the authorization code in localStorage',async()=>{h.connect.mockResolvedValue({...account,status:'connected'});page();await openConnector('添加 QQ 邮箱');fireEvent.change(screen.getByLabelText('邮箱地址'),{target:{value:account.email}});fireEvent.change(screen.getByLabelText('客户端授权码'),{target:{value:'private-code'}});fireEvent.click(screen.getByRole('button',{name:'测试并连接'}));await waitFor(()=>expect(h.connect).toHaveBeenCalledTimes(1));expect(h.connect.mock.calls[0][0]).toMatchObject({provider:'qq',email:account.email,password:'private-code',allowSend:false,expectedRevision:0});expect(JSON.stringify(localStorage)).not.toContain('private-code');});
it('shows transport read failures distinctly from an empty connected list',async()=>{h.list.mockRejectedValue(Error('offline'));page();await screen.findByRole('alert');expect(screen.queryByText('还没有连接邮箱')).toBeNull();});
it('uses OAuth for Gmail and explains the required application ID instead of requesting the email password',async()=>{page();await openConnector('添加 Gmail');expect(screen.getByLabelText('OAuth 应用 ID')).toBeVisible();expect(screen.queryByLabelText('客户端授权码')).toBeNull();expect(screen.getByText(/此版本尚未内置/)).toBeVisible();expect(h.start).not.toHaveBeenCalled();});
it('requires confirmation to remove and treats uncertain writes as unknown until a fresh read',async()=>{h.list.mockResolvedValue([account]);h.remove.mockRejectedValue(Error('transport closed'));page();fireEvent.click(await screen.findByRole('button',{name:'移除 example@qq.com'}));expect(h.remove).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认移除'}));await screen.findByText('操作结果尚未确认，请刷新账号列表后再继续。');expect(h.remove).toHaveBeenCalledTimes(1);});

it('does not carry a failed OAuth notice into a different provider form',async()=>{
 h.start.mockResolvedValue({phase:'failed',operationId:'11111111-1111-4111-8111-111111111111'});page();await openConnector('添加 Gmail');fireEvent.change(screen.getByLabelText('OAuth 应用 ID'),{target:{value:'registered-client-id'}});fireEvent.click(screen.getByRole('button',{name:'打开浏览器授权'}));await screen.findByText('邮箱授权未完成，请重新连接。');fireEvent.click(screen.getByRole('button',{name:'关闭邮箱配置'}));fireEvent.click(screen.getByRole('button',{name:'添加 QQ 邮箱'}));expect(screen.queryByText('邮箱授权未完成，请重新连接。')).toBeNull();
});

it('defaults sending to off and only saves a send grant after the user selects it',async()=>{
 h.connect.mockResolvedValue({...account,allowSend:true,status:'connected'});page();await openConnector('添加 QQ 邮箱');const permission=screen.getByRole('checkbox',{name:/允许小K发送邮件/});expect(permission).not.toBeChecked();expect(screen.queryByText('允许小K助理读取此邮箱')).toBeNull();fireEvent.click(permission);fireEvent.change(screen.getByLabelText('邮箱地址'),{target:{value:account.email}});fireEvent.change(screen.getByLabelText('客户端授权码'),{target:{value:'private-code'}});fireEvent.click(screen.getByRole('button',{name:'测试并连接'}));await waitFor(()=>expect(h.connect).toHaveBeenCalledWith(expect.objectContaining({allowSend:true})));
});


it('manages a newly connected 163 account, reconnects the same identity, and removes only after confirmation',async()=>{
 let rows:typeof account[]=[];h.list.mockImplementation(async()=>rows);
 const net={...account,id:'b'.repeat(32),provider:'netease163',email:'qa@163.com',host:'imap.163.com',status:'connected'};
 h.connect.mockImplementation(async input=>{const saved={...net,allowSend:input.allowSend,revision:input.expectedRevision+1};rows=[saved];return saved;});
 h.remove.mockImplementation(async()=>{rows=[];return{ok:true};});page();await openConnector('添加 163 邮箱');
 fireEvent.change(screen.getByLabelText('邮箱地址'),{target:{value:net.email}});fireEvent.change(screen.getByLabelText('客户端授权码'),{target:{value:'synthetic-code'}});fireEvent.click(screen.getByRole('button',{name:'测试并连接'}));
 await screen.findByRole('button',{name:'管理 163 邮箱'});await openConnector('管理 163 邮箱');
 const form=screen.getByRole('dialog');expect(within(form).getByLabelText('邮箱地址')).toHaveValue(net.email);expect(within(form).getByLabelText('邮箱地址')).toBeDisabled();
 fireEvent.change(within(form).getByLabelText('客户端授权码'),{target:{value:'synthetic-new-code'}});fireEvent.click(within(form).getByRole('button',{name:'重新连接'}));
 await waitFor(()=>expect(h.connect).toHaveBeenCalledTimes(2));expect(h.connect.mock.calls[1][0]).toMatchObject({email:net.email,provider:'netease163',expectedRevision:1,password:'synthetic-new-code'});expect(rows).toHaveLength(1);
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());await openConnector('管理 163 邮箱');
 const dialog=screen.getByRole('dialog');fireEvent.click(within(dialog).getByRole('button',{name:'移除账号'}));expect(h.remove).not.toHaveBeenCalled();fireEvent.click(within(dialog).getByRole('button',{name:'确认移除'}));
 await waitFor(()=>expect(h.remove).toHaveBeenCalledExactlyOnceWith({id:net.id,expectedRevision:2}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(rows).toHaveLength(0);
 expect(JSON.stringify(localStorage)).not.toContain('synthetic-new-code');
});
it.each(['qq','netease163','imap','gmail','outlook'])('opens existing %s account management instead of an empty add form',async provider=>{
 const row={...account,provider,email:provider+'@example.com'};h.list.mockResolvedValue([row]);page();
 // Use the visible provider name from the actual card, not an invented backend identity.
 const card=await screen.findByRole('button',{name:zh.mailConnectors.manageProvider(zh.mailConnectors.providers[provider as keyof typeof zh.mailConnectors.providers].name)});
 fireEvent.click(card);const dialog=await screen.findByRole('dialog');expect(within(dialog).getByText(row.email)).toBeVisible();expect(within(dialog).getByRole('button',{name:'移除账号'})).toBeVisible();expect(h.connect).not.toHaveBeenCalled();expect(h.start).not.toHaveBeenCalled();
});
it('lets the user choose between two accounts for the same connected provider',async()=>{
 h.list.mockResolvedValue([{...account,provider:'netease163',email:'one@163.com'},{...account,id:'b'.repeat(32),provider:'netease163',email:'two@163.com'}]);page();await openConnector('管理 163 邮箱');
 expect(screen.queryByRole('dialog')).toBeNull();const list=screen.getByRole('region',{name:'已添加的邮箱'});const articles=within(list).getAllByRole('article');expect(articles).toHaveLength(2);
 fireEvent.click(within(articles[1]).getByRole('button',{name:'管理'}));expect(screen.getByLabelText('邮箱地址')).toHaveValue('two@163.com');
});

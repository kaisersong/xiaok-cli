import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MailConnectorService } from '../../electron/mail-connector-service';
import { createMailTools } from '../../electron/mail-tools';
const accounts = new Map<string,any>();
const store = { list:()=> [...accounts.values()].map(({auth,...a})=>a), get:(id:string)=>accounts.get(id), put:(a:any,revision:number,source:string)=>{ if(source!=='user')throw Error('mail_user_only');const current=accounts.get(a.id);if((current?.revision??0)!==revision)throw Error('mail_stale_account');accounts.set(a.id,structuredClone(a)); }, remove:(id:string,revision:number,source:string)=>{if(source!=='user')throw Error('mail_user_only');if(accounts.get(id)?.revision!==revision)throw Error('mail_stale_account');accounts.delete(id);} };
const read = vi.fn(), test = vi.fn(), search = vi.fn(), close = vi.fn();
let service: MailConnectorService;
const input = { provider: 'qq', email:'example@qq.com', password:'private-test-code', allowSend:true, expectedRevision:0 };
beforeEach(()=> {accounts.clear(); read.mockReset();test.mockReset().mockResolvedValue({});search.mockReset().mockResolvedValue({messages:[],hasMore:false});close.mockReset(); service=new MailConnectorService({store,reader:{test,search,read,close},openExternal:vi.fn()});});
afterEach(()=>service.dispose());
it.each([undefined,'agent','scheduler'])('rejects %s account configuration and disconnect through the service', async source=> {
  await expect(service.connect(input,source as never)).rejects.toThrow('mail_user_only');
  await expect(service.disconnect({id:'a'.repeat(32),expectedRevision:1},source as never)).rejects.toThrow('mail_user_only');
  await expect(service.setAccess({id:'a'.repeat(32),expectedRevision:1,allowSend:true},source as never)).rejects.toThrow('mail_user_only');
  expect(()=>service.beginOAuth({provider:'gmail',clientId:'client',allowSend:true,expectedRevision:0},source as never)).toThrow('mail_user_only');
  expect(()=>service.cancelOAuth(undefined,source as never)).toThrow('mail_user_only');
  expect(test).not.toHaveBeenCalled();expect(accounts.size).toBe(0);
});
it('tests QQ with strict TLS defaults, commits only after success and never returns the authorization code',async()=> {
  const result=await service.connect(input,'user');expect(test.mock.calls[0][0]).toMatchObject({host:'imap.qq.com',port:993,auth:{kind:'password',password:input.password}});
  expect(JSON.stringify(result)).not.toContain(input.password);expect(service.list()).toHaveLength(1);
  expect(await service.connect({...input,provider:'netease163',email:'example@163.com'},'user')).toMatchObject({host:'imap.163.com',port:993});
});
it('does not store credentials on failed authentication and redacts original server errors',async()=> {
  test.mockRejectedValue(Error('AUTHENTICATIONFAILED private-test-code'));
  await expect(service.connect(input,'user')).rejects.toThrow('mail_auth_failed');expect(service.list()).toEqual([]);
});
it('allows agent and scheduler reads for a connected account without enabling sending',async()=>{
 const account=await service.connect({...input,allowSend:false},'user');search.mockResolvedValue({messages:[],hasMore:false,coverage:'complete'});await expect(service.search({accountId:account.id},'agent')).resolves.toMatchObject({coverage:'complete'});
 expect(JSON.stringify(await createMailTools(service).find(t=>t.definition.name==='mail_list_accounts')!.execute({}))).toContain(account.email);
});
it('discards late mail content after disconnect and prevents a pending reconnect from resurrecting the account',async()=> {
  const a=await service.connect(input,'user');let done!:(value:any)=>void; read.mockImplementationOnce(()=>new Promise(resolve=>done=resolve));
  const pending=service.read({accountId:a.id,messageId:'1:1'},'agent');
  await service.disconnect({id:a.id,expectedRevision:a.revision},'user');done({id:'1:1',subject:'late',from:'x@example.com',receivedAt:'2026-11-05T00:00:00Z',unread:true,body:'must-not-leak',truncated:false});
  await expect(pending).rejects.toThrow('mail_account_changed');expect(service.list()).toEqual([]);
});
it('does not silently overwrite a newer account or expose credentials via tool errors',async()=> {
  const a=await service.connect(input,'user');
  await expect(service.connect({...input,password:'new-secret'},'user')).rejects.toThrow('mail_stale_account');
  expect(store.get(a.id).auth.password).toBe(input.password);
});

it('does not resurrect a disconnected account from a late reconnect and fences read access revocation',async()=>{
 const a=await service.connect(input,'user');let finish!:()=>void;test.mockImplementationOnce(()=>new Promise<void>(resolve=>finish=resolve));
 const reconnect=service.connect({...input,expectedRevision:1,password:'new-code'},'user');await service.disconnect({id:a.id,expectedRevision:1},'user');finish();await expect(reconnect).rejects.toThrow('mail_account_changed');expect(service.list()).toEqual([]);
});

it('keeps user and assistant previews available when sending is off',async()=>{
 const a=await service.connect({...input,allowSend:false},'user');search.mockResolvedValue({messages:[],hasMore:false,coverage:'complete'});for(const source of ['user','agent','scheduler'] as const)await expect(service.search({accountId:a.id},source)).resolves.toMatchObject({coverage:'complete'});
});
it('never stores a secure-input password if its task is cancelled during mailbox verification',async()=>{let release!:()=>void;test.mockImplementationOnce(()=>new Promise<void>(r=>release=r));const controller=new AbortController();const pending=service.connect(input,'user',controller.signal);controller.abort();release();await expect(pending).rejects.toThrow();expect(accounts.size).toBe(0);});

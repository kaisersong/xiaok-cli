import { expect, it, vi } from 'vitest';
import { ImapMailReader } from '../../electron/mail-imap-reader';
const account={id:'a'.repeat(32),provider:'qq',email:'x@qq.com',host:'imap.qq.com',port:993,allowSend:true,revision:1,auth:{kind:'password',password:'secret'}};
function fixture() { const release=vi.fn();const client={connect:vi.fn(),getMailboxLock:vi.fn().mockResolvedValue({release}),mailbox:{uidValidity:42n,exists:2,readOnly:true},search:vi.fn().mockResolvedValue([1,2]),fetchAll:vi.fn().mockResolvedValue([{uid:2,envelope:{subject:'重要邮件',from:[{address:'sender@example.com'}]},internalDate:new Date('2026-11-05T00:00:00Z'),flags:new Set()}]),fetchOne:vi.fn().mockResolvedValue({uid:2,source:Buffer.from('From: sender@example.com\r\nSubject: Test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello'),size:100}),logout:vi.fn(),close:vi.fn(),on:vi.fn()}; const factory=vi.fn().mockReturnValue(client);return {client,factory,reader:new ImapMailReader(factory)}; }
it('uses verified TLS and EXAMINE, returns stable message identities and truthful truncation',async()=> {
 const {client,factory,reader}=fixture();const result=await reader.search(account as never,{limit:1});
 expect(factory.mock.calls[0][0]).toMatchObject({host:'imap.qq.com',port:993,secure:true,tls:{rejectUnauthorized:true},logger:false});
 expect(client.getMailboxLock).toHaveBeenCalledWith('INBOX',{readOnly:true});expect(result.messages[0].id).toBe('42:2');expect(result.hasMore).toBe(true);expect(client.logout).toHaveBeenCalled();
});
it('refuses stale UIDVALIDITY and bounds raw bodies without setting Seen',async()=> {
 const {client,reader}=fixture();await expect(reader.read(account as never,{messageId:'41:2'})).rejects.toThrow('mail_message_changed');
 expect(client.fetchOne).not.toHaveBeenCalled();const body=await reader.read(account as never,{messageId:'42:2'});expect(body.body).toContain('hello');
 expect(client.fetchOne.mock.calls[0]).toEqual([2,expect.objectContaining({source:{start:0,maxLength:131072}}),{uid:true}]);
 expect(client).not.toHaveProperty('messageFlagsAdd');
});

it('paginates non-contiguous unsorted UIDs and advances past out-of-window rows without skipping lower UIDs',async()=>{
 const {client,reader}=fixture();const since=new Date(Date.now()-3600000).toISOString();client.search.mockResolvedValue([49,100,98,50,99]);
 client.fetchAll.mockImplementation(async(uids:number[])=>uids.map(uid=>({uid,envelope:{subject:`message ${uid}`,from:[]},internalDate:new Date(uid===98?Date.now()-7200000:Date.now()),flags:new Set()})));
 const first=await reader.search(account as never,{limit:3,since});expect(first.messages.map(m=>m.id)).toEqual(['42:100','42:99']);expect(first.hasMore).toBe(true);
 const second=await reader.search(account as never,{limit:3,cursor:first.cursor});expect(second.messages.map(m=>m.id)).toEqual(['42:50','42:49']);expect(second.hasMore).toBe(false);
});

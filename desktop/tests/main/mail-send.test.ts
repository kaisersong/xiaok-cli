// @vitest-environment node
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';import {join}from'node:path';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID}from'node:crypto';
import { MailAccountStore } from '../../electron/mail-account-store';
import { MailConnectorService } from '../../electron/mail-connector-service';
import { createMailTools } from '../../electron/mail-tools';
const key=randomBytes(32);const crypto={isEncryptionAvailable:()=>true,encryptString(text:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);},decryptString(_data:Buffer){return '';}};
crypto.encryptString=text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]);};crypto.decryptString=data=>{const d=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));d.setAuthTag(data.subarray(12,28));return Buffer.concat([d.update(data.subarray(28)),d.final()]).toString();};
let root:string,store:MailAccountStore,service:MailConnectorService;const send=vi.fn(),close=vi.fn();
const input={provider:'qq',email:'example@qq.com',password:'local-test-secret',allowSend:false,expectedRevision:0};
const message=(accountId:string,requestId=randomUUID())=>({accountId,requestId,to:['recipient@example.com'],subject:'Check the draft',text:'Please review.'});
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'xiaok-send-'));store=new MailAccountStore(root,crypto);send.mockReset().mockResolvedValue({status:'accepted',messageId:'local-id',accepted:['recipient@example.com'],rejected:[]});close.mockReset();service=new MailConnectorService({store,reader:{test:async()=>({}),search:async()=>({messages:[],hasMore:false,coverage:'complete'}),read:vi.fn(),close},sender:{send,close},openExternal:vi.fn()});});
afterEach(()=>{service.dispose();rmSync(root,{recursive:true,force:true});});
it('implicitly permits reads after connecting while every source is denied sending by default',async()=>{
 const account=await service.connect(input,'user');await expect(service.search({accountId:account.id},'agent')).resolves.toMatchObject({coverage:'complete'});
 for(const source of ['user','agent','scheduler',undefined])await expect(service.send(message(account.id),source as never)).rejects.toThrow(/mail_send_denied|mail_assistant_access_denied/);
 expect(send).not.toHaveBeenCalled();expect(createMailTools(service).find(t=>t.definition.name==='mail_send')?.permission).toBe('write');
});
it('allows only user changes, sends once, replays accepted receipts and persists them across restart',async()=>{
 const a=await service.connect(input,'user');for(const source of [undefined,'agent','scheduler'])await expect(service.setAccess({id:a.id,expectedRevision:a.revision,allowSend:true},source as never)).rejects.toThrow('mail_user_only');
 await service.setAccess({id:a.id,expectedRevision:a.revision,allowSend:true},'user');const draft=message(a.id);const result=await service.send(draft,'agent');expect(result.status).toBe('accepted');expect(await service.send(draft,'agent')).toEqual(result);expect(send).toHaveBeenCalledTimes(1);
 service.dispose();service=new MailConnectorService({store:new MailAccountStore(root,crypto),reader:{test:vi.fn(),search:vi.fn(),read:vi.fn(),close},sender:{send,close},openExternal:vi.fn()});expect(await service.send(draft,'agent')).toEqual(result);expect(send).toHaveBeenCalledTimes(1);
 await expect(service.send({...draft,text:'changed'},'agent')).rejects.toThrow('mail_send_conflict');
});
it('does not repeat unknown deliveries even with a different requestId and after a settings update',async()=>{
 const a=await service.connect({...input,allowSend:true},'user');const draft=message(a.id);send.mockImplementationOnce(async(_a,_m,assert)=>{assert();throw Error('connection lost local-test-secret');});
 await expect(service.send(draft,'agent')).rejects.toThrow('mail_send_unknown');await service.setAccess({id:a.id,expectedRevision:1,allowSend:true},'user');
 await expect(service.send(draft,'agent')).rejects.toThrow('mail_send_unknown');await expect(service.send({...draft,requestId:randomUUID()},'agent')).rejects.toThrow('mail_send_unknown');expect(send).toHaveBeenCalledTimes(1);
});
it('fences pending sends at the transport boundary when permission is revoked',async()=>{
 const a=await service.connect({...input,allowSend:true},'user');let finish!:()=>void;const committed=vi.fn();send.mockImplementationOnce(async(_a,_m,assertCurrent)=>{await new Promise<void>(resolve=>finish=resolve);assertCurrent();committed();return {status:'accepted'};});const pending=service.send(message(a.id),'agent');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));await service.setAccess({id:a.id,expectedRevision:1,allowSend:false},'user');finish();await expect(pending).rejects.toThrow('mail_account_changed');expect(committed).not.toHaveBeenCalled();
});
it('records a definite late acceptance even after disconnect, keeping the delivery journal',async()=>{
 const a=await service.connect({...input,allowSend:true},'user');let finish!:(v:unknown)=>void;send.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));const draft=message(a.id),pending=service.send(draft,'agent');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));await service.disconnect({id:a.id,expectedRevision:1},'user');finish({status:'accepted',messageId:'accepted-late',accepted:draft.to,rejected:[]});expect(await pending).toMatchObject({status:'accepted',messageId:'accepted-late'});expect(store.getSendReceipt(draft.requestId)?.status).toBe('accepted');
});
it('rejects injected headers, forged sender and attachment fields before any sending',async()=>{
 const a=await service.connect({...input,allowSend:true},'user');for(const patch of [{subject:'Hi\r\nBcc: victim@example.com'},{from:'other@example.com'},{attachments:[{path:'/private/file'}]}])await expect(service.send({...message(a.id),...patch},'agent')).rejects.toThrow();expect(send).not.toHaveBeenCalled();
});
it('never migrates an old read grant into a send grant',async()=>{
 const a=await service.connect(input,'user');const legacy={...store.get(a.id),allowAssistant:true};delete (legacy as any).allowSend;writeFileSync(join(root,'mail-accounts','accounts.enc'),crypto.encryptString(JSON.stringify({version:1,accounts:[legacy]})));
 expect(new MailAccountStore(root,crypto).list()[0]).toMatchObject({allowSend:false});expect(new MailAccountStore(root,crypto).get(a.id)).not.toHaveProperty('allowAssistant');
});
it('marks a definite provider rejection retryable only with an explicit new requestId',async()=>{
 const {MailSubmissionRejected}=await import('../../electron/mail-send-errors');const a=await service.connect({...input,allowSend:true},'user'),draft=message(a.id);send.mockImplementationOnce(async(_a,_m,assert)=>{assert();throw new MailSubmissionRejected('mail_send_rejected');});
 await expect(service.send(draft,'agent')).rejects.toThrow('mail_send_rejected');expect(store.getSendReceipt(draft.requestId)?.status).toBe('rejected');await expect(service.send(draft,'agent')).rejects.toThrow('mail_send_rejected');expect(send).toHaveBeenCalledTimes(1);expect(await service.send({...draft,requestId:randomUUID()},'agent')).toMatchObject({status:'accepted'});expect(send).toHaveBeenCalledTimes(2);
});
it('does not turn a legacy read flag supplied through a live write into send permission',async()=>{
 await expect(service.connect({...input,allowAssistant:true} as never,'user')).rejects.toThrow('mail_invalid_input');expect(store.list()).toEqual([]);
});
it('does not enable sending for an old OAuth account without provider scope proof',async()=>{
 const id='d'.repeat(32);store.put({id,provider:'gmail',email:'me@example.com',host:'gmail.googleapis.com',port:443,allowSend:false,revision:1,auth:{kind:'oauth',clientId:'client',refreshToken:'refresh',sendAuthorized:false}},0,'user');await expect(service.setAccess({id,expectedRevision:1,allowSend:true},'user')).rejects.toThrow('mail_send_reauthorize');expect(store.get(id)?.allowSend).toBe(false);
});

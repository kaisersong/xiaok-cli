// @vitest-environment node
import { expect,it,vi } from 'vitest';
import { OAuthMailReader } from '../../electron/mail-oauth-reader';
const a={id:'b'.repeat(32),provider:'outlook',email:'x@example.com',host:'graph.microsoft.com',port:443,allowSend:true,revision:1,auth:{kind:'oauth',clientId:'client',refreshToken:'private-refresh'}};
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
it('refuses a provider nextLink pointing elsewhere without sending tokens to it',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response({access_token:'access',expires_in:3600})).mockResolvedValueOnce(response({value:[],'@odata.nextLink':'https://attacker.invalid/steal?token=x'}));
 const reader=new OAuthMailReader({fetch:fetcher});await expect(reader.search(a as never,{})).rejects.toThrow('mail_network_error');
 expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls.every(([url])=>!String(url).includes('attacker.invalid'))).toBe(true);reader.close();
});
it('serializes concurrent token refreshes and persists only a narrow refresh rotation',async()=>{
 const rotate=vi.fn();const fetcher=vi.fn().mockImplementation(async url=>String(url).includes('/token')?response({access_token:'access',refresh_token:'rotated',expires_in:3600}):response({value:[]}));
 const reader=new OAuthMailReader({fetch:fetcher,onRefresh:rotate});await Promise.all([reader.search(a as never,{}),reader.search(a as never,{})]);
 expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/token'))).toHaveLength(1);expect(rotate).toHaveBeenCalledExactlyOnceWith(a,'rotated');reader.close();
});
it('requires the granted Gmail read scope before accepting an OAuth identity',async()=>{
 const fetcher=vi.fn().mockResolvedValue(response({access_token:'access',refresh_token:'refresh',scope:'openid email'}));const reader=new OAuthMailReader({fetch:fetcher});
 await expect(reader.authorize({provider:'gmail',clientId:'client',allowSend:true,expectedRevision:0},'code','verifier','http://127.0.0.1/callback',new AbortController().signal)).rejects.toThrow('mail_authorization_failed');expect(fetcher).toHaveBeenCalledTimes(1);reader.close();
});
it('marks a snippet fallback as partial content instead of presenting an absent MIME body as complete',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response({access_token:'access',expires_in:3600})).mockResolvedValueOnce(response({id:'m1',internalDate:'1793880000000',labelIds:[],payload:{headers:[]},snippet:'Only a preview'}));const reader=new OAuthMailReader({fetch:fetcher});
 expect(await reader.read({...a,provider:'gmail'} as never,{messageId:'m1'})).toMatchObject({body:'Only a preview',truncated:true});reader.close();
});

it.each(['base64','base64url'] as const)('decodes Chinese Gmail MIME bodies with %s using the real Node decoder',async encoding=>{
 const text='中文邮件正文：请在周五之前确认。';const fetcher=vi.fn().mockResolvedValueOnce(response({access_token:'access',expires_in:3600})).mockResolvedValueOnce(response({id:'m2',internalDate:'1793880000000',labelIds:[],payload:{mimeType:'text/plain',headers:[],body:{data:Buffer.from(text).toString(encoding)}}}));const reader=new OAuthMailReader({fetch:fetcher});
 expect((await reader.read({...a,provider:'gmail'} as never,{messageId:'m2'})).body.trim()).toBe(text);reader.close();
});

it('requires the actual current token send scope, never trusting only the stored proof',async()=>{
 const fetcher=vi.fn().mockResolvedValue(response({access_token:'access',expires_in:3600,scope:'Mail.Read'})),reader=new OAuthMailReader({fetch:fetcher});
 await expect(reader.send({...a,allowSend:true,auth:{...a.auth,sendAuthorized:true}} as never,{accountId:a.id,requestId:crypto.randomUUID(),to:['to@example.com'],subject:'Hi',text:'Body'},vi.fn())).rejects.toThrow('mail_send_reauthorize');expect(fetcher).toHaveBeenCalledTimes(1);reader.close();
});
it('uses the fixed Graph sendMail endpoint and accepts a 202 empty response without claiming delivery',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response({access_token:'access',expires_in:3600,scope:'Mail.Read Mail.Send'})).mockResolvedValueOnce(new Response(null,{status:202})),reader=new OAuthMailReader({fetch:fetcher}),assert=vi.fn();
 expect(await reader.send({...a,allowSend:true,auth:{...a.auth,sendAuthorized:true}} as never,{accountId:a.id,requestId:crypto.randomUUID(),to:['to@example.com'],subject:'Hi',text:'Body'},assert)).toMatchObject({status:'accepted'});expect(assert).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/me/sendMail');expect(fetcher.mock.calls[1][1]).toMatchObject({method:'POST',redirect:'error'});reader.close();
});
it('posts Gmail raw MIME with the connected sender and requested recipients only',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response({access_token:'access',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'})).mockResolvedValueOnce(response({id:'sent1'})),reader=new OAuthMailReader({fetch:fetcher});
 const result=await reader.send({...a,provider:'gmail',allowSend:true,auth:{...a.auth,sendAuthorized:true}} as never,{accountId:a.id,requestId:crypto.randomUUID(),to:['to@example.com'],subject:'你好',text:'中文正文'},vi.fn());expect(result).toMatchObject({status:'accepted',messageId:'sent1'});const [url,options]=fetcher.mock.calls[1];expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');const raw=Buffer.from(JSON.parse(options.body as string).raw,'base64url').toString();expect(raw).toContain('From: x@example.com');expect(raw).toContain('To: to@example.com');reader.close();
});
it('distinguishes definite provider rejection from a lost send response without moving the submission guard after POST',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response({access_token:'access',expires_in:3600,scope:'Mail.Read Mail.Send'})).mockResolvedValueOnce(response({error:{code:'AccessDenied'}},403)),reader=new OAuthMailReader({fetch:fetcher}),assert=vi.fn();
 const {MailSubmissionRejected}=await import('../../electron/mail-send-errors');await expect(reader.send({...a,allowSend:true,auth:{...a.auth,sendAuthorized:true}} as never,{accountId:a.id,requestId:crypto.randomUUID(),to:['to@example.com'],subject:'Hi',text:'Body'},assert)).rejects.toBeInstanceOf(MailSubmissionRejected);expect(assert).toHaveBeenCalledTimes(1);reader.close();
});

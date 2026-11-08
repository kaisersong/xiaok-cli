import { MailSubmissionRejected } from './mail-send-errors.js';
import { createHash } from 'node:crypto';
import { MAIL_SEND_SCHEMA,MAIL_SEND_RESULT_SCHEMA,MAIL_ACCESS_SCHEMA,MAIL_CONNECT_SCHEMA,MAIL_ACCOUNT_REQUEST_SCHEMA,MAIL_OAUTH_INPUT_SCHEMA,MAIL_SEARCH_SCHEMA,MAIL_READ_SCHEMA,MAIL_SEARCH_RESULT_SCHEMA,MAIL_READ_RESULT_SCHEMA,MAIL_ERROR_CODES,type MailAccountDto,type MailConnectInput,type MailOAuthInput,type MailRequestSource,type MailSearchInput,type MailReadInput,type MailSearchResult,type MailReadResult,type MailSendInput,type MailSendResult } from '../shared/mail-connectors-ipc-contract.js';
import { requireMailUser,type MailAccountRecord,type MailStore } from './mail-account-store.js';
import { ImapMailReader,type MailReader } from './mail-imap-reader.js';
import { OAuthMailReader } from './mail-oauth-reader.js';
import { MailSmtpSender,type MailSender } from './mail-smtp-sender.js';
import { MailOAuthFlow } from './mail-oauth-flow.js';
export function mailError(error:unknown):Error {
 const message=error instanceof Error?error.message:'';
 if((MAIL_ERROR_CODES as readonly string[]).includes(message))return Error(message);
 if(/authenticationfailed|authfailed|invalid.login|invalid.credentials/i.test(message))return Error('mail_auth_failed');
 if(/timeout|timed.out/i.test(message))return Error('mail_timeout');return Error('mail_network_error');
}
const accountId=(provider:string,email:string,host:string,port:number)=>createHash('sha256').update(JSON.stringify([provider,email.toLowerCase(),host.toLowerCase(),port])).digest('hex').slice(0,32);
interface Dependencies {store:MailStore;reader?:MailReader;sender?:MailSender;openExternal(url:string):Promise<void>;fetch?:typeof fetch}
export class MailConnectorService {
 private readonly reader:MailReader;private readonly sender:MailSender;private readonly oauthReader:OAuthMailReader;private readonly oauth:MailOAuthFlow;
 private readonly generation=new Map<string,number>();private readonly status=new Map<string,{status:MailAccountDto['status'];errorCode?:MailAccountDto['errorCode']}>();private disposed=false;
 constructor(private readonly deps:Dependencies){
  this.oauthReader=new OAuthMailReader({fetch:deps.fetch,onRefresh:(a,token)=>{if(!deps.store.rotateRefreshToken)throw Error('mail_store_unavailable');deps.store.rotateRefreshToken(a.id,a.revision,a.auth.kind==='oauth'?a.auth.refreshToken:'',token,'scheduler');}});
  const imap=new ImapMailReader();this.reader=deps.reader??{test:a=>a.auth.kind==='oauth'?this.oauthReader.test(a):imap.test(a),search:(a,i)=>a.auth.kind==='oauth'?this.oauthReader.search(a,i):imap.search(a,i),read:(a,i)=>a.auth.kind==='oauth'?this.oauthReader.read(a,i):imap.read(a,i),close:id=>{imap.close(id);this.oauthReader.close(id);}};
  const smtp=new MailSmtpSender();this.sender=deps.sender??{send:(a,i,assert)=>a.auth.kind==='oauth'?this.oauthReader.send(a,i,assert):smtp.send(a,i,assert),close:id=>smtp.close(id)};
  this.oauth=new MailOAuthFlow({openExternal:deps.openExternal,authorize:async(input,code,verifier,redirect,signal,assertCurrent)=>{
   const result=await this.oauthReader.authorize(input,code,verifier,redirect,signal);assertCurrent();const host=input.provider==='gmail'?'gmail.googleapis.com':'graph.microsoft.com';const id=accountId(input.provider,result.email,host,443);
   if(input.accountId&&input.accountId!==id)throw Error('mail_stale_account');const revision=this.deps.store.get(id)?.revision??0;if(revision!==input.expectedRevision)throw Error('mail_stale_account');assertCurrent();
   return ()=>{assertCurrent();this.deps.store.put({id,provider:input.provider,email:result.email,host,port:443,allowSend:input.allowSend,revision:revision+1,lastVerifiedAt:Date.now(),auth:{kind:'oauth',clientId:input.clientId,...(input.clientSecret?{clientSecret:input.clientSecret}:{}),refreshToken:result.refreshToken,sendAuthorized:result.sendAuthorized}},revision,'user');this.invalidate(id);this.status.set(id,{status:'connected'});};
  }});
 }
 private invalidate(id:string):void{this.generation.set(id,(this.generation.get(id)??0)+1);this.reader.close(id);this.sender.close(id);}
 list():MailAccountDto[]{return this.deps.store.list().map(a=>({...a,status:'saved',...this.status.get(a.id)}));}
 private account(id:string,source:MailRequestSource):MailAccountRecord{
  if(!['user','agent','scheduler'].includes(source)||this.disposed)throw Error('mail_assistant_access_denied');const a=this.deps.store.get(id);if(!a)throw Error('mail_account_not_found');return a;
 }
 private async use<T>(id:string,source:MailRequestSource,operation:(a:MailAccountRecord)=>Promise<T>):Promise<T>{
  const a=this.account(id,source),generation=this.generation.get(id)??0;let timer:ReturnType<typeof setTimeout>|undefined;
  try{const value=await Promise.race([operation(a),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{this.invalidate(id);reject(Error('mail_timeout'));},45000);timer.unref?.();})]);
   const current=this.deps.store.get(id);if(this.disposed||!current||current.revision!==a.revision||(this.generation.get(id)??0)!==generation)throw Error('mail_account_changed');this.status.set(id,{status:'connected'});return value;
  }catch(error){const safe=mailError(error);if(this.deps.store.get(id)?.revision===a.revision&&(this.generation.get(id)??0)===generation)this.status.set(id,{status:safe.message==='mail_needs_reconnect'||safe.message==='mail_auth_failed'?'needs_reconnect':'error',errorCode:safe.message as MailAccountDto['errorCode']});throw safe;}finally{if(timer)clearTimeout(timer);}
 }
 async connect(raw:MailConnectInput,source:MailRequestSource):Promise<MailAccountDto>{
  requireMailUser(source);let input:MailConnectInput;try{input=MAIL_CONNECT_SCHEMA.parse(raw);}catch{throw Error('mail_invalid_input');}if(this.disposed)throw Error('mail_account_changed');
  const host=input.provider==='qq'?'imap.qq.com':input.provider==='netease163'?'imap.163.com':input.host;if(!host)throw Error('mail_invalid_input');const port=input.provider==='imap'?(input.port??993):993,email=input.email.toLowerCase();const id=accountId(input.provider,email,host,port);
  if((this.deps.store.get(id)?.revision??0)!==input.expectedRevision)throw Error('mail_stale_account');this.invalidate(id);const generation=this.generation.get(id);
  const a:MailAccountRecord={id,provider:input.provider,email,host,port,allowSend:input.allowSend,...(input.smtpHost?{smtpHost:input.smtpHost,smtpPort:input.smtpPort??465}:{}),revision:input.expectedRevision+1,lastVerifiedAt:Date.now(),auth:{kind:'password',password:input.password}};
  if(input.allowSend&&input.provider==='imap'&&!input.smtpHost)throw Error('mail_invalid_input');
  try{await this.reader.test(a);if(this.disposed||this.generation.get(id)!==generation)throw Error('mail_account_changed');this.deps.store.put({...a,lastVerifiedAt:Date.now()},input.expectedRevision,'user');this.status.set(id,{status:'connected'});return this.list().find(row=>row.id===id)!;}catch(error){throw mailError(error);}
 }
 async disconnect(raw:{id:string;expectedRevision:number},source:MailRequestSource):Promise<{ok:true}>{
  requireMailUser(source);const input=MAIL_ACCOUNT_REQUEST_SCHEMA.parse(raw);this.deps.store.remove(input.id,input.expectedRevision,'user');this.invalidate(input.id);this.status.delete(input.id);await this.oauth.cancel(undefined,'user');return {ok:true};
 }
 async test(raw:{id:string;expectedRevision:number},source:MailRequestSource):Promise<MailAccountDto>{requireMailUser(source);const input=MAIL_ACCOUNT_REQUEST_SCHEMA.parse(raw);if(this.account(input.id,'user').revision!==input.expectedRevision)throw Error('mail_stale_account');await this.use(input.id,'user',a=>this.reader.test(a));return this.list().find(a=>a.id===input.id)!;}
 search(raw:MailSearchInput,source:MailRequestSource):Promise<MailSearchResult>{const input=MAIL_SEARCH_SCHEMA.parse(raw);return this.use(input.accountId,source,async a=>MAIL_SEARCH_RESULT_SCHEMA.parse(await this.reader.search(a,input)));}
 read(raw:MailReadInput,source:MailRequestSource):Promise<MailReadResult>{const input=MAIL_READ_SCHEMA.parse(raw);return this.use(input.accountId,source,async a=>MAIL_READ_RESULT_SCHEMA.parse(await this.reader.read(a,input)));}
 async setAccess(raw:{id:string;expectedRevision:number;allowSend:boolean;smtpHost?:string;smtpPort?:number},source:MailRequestSource):Promise<MailAccountDto>{requireMailUser(source);const input=MAIL_ACCESS_SCHEMA.parse(raw),a=this.account(input.id,'user');if(a.revision!==input.expectedRevision)throw Error('mail_stale_account');if(input.allowSend&&a.auth.kind==='oauth'&&!a.auth.sendAuthorized)throw Error('mail_send_reauthorize');if(input.allowSend&&a.provider==='imap'&&!(input.smtpHost??a.smtpHost))throw Error('mail_invalid_input');this.deps.store.put({...a,allowSend:input.allowSend,...(input.smtpHost?{smtpHost:input.smtpHost,smtpPort:input.smtpPort??465}:{}),revision:a.revision+1},a.revision,'user');this.invalidate(a.id);return this.list().find(row=>row.id===a.id)!;}
 async send(raw:MailSendInput,source:MailRequestSource):Promise<MailSendResult>{
  if(source!=='user')throw Error('mail_send_denied');
  let input:MailSendInput;try{input=MAIL_SEND_SCHEMA.parse(raw);}catch{throw Error('mail_invalid_input');}
  const account=this.account(input.accountId,source);if(!account.allowSend)throw Error('mail_send_denied');if(account.auth.kind==='oauth'&&!account.auth.sendAuthorized)throw Error('mail_send_reauthorize');
  const begin=this.deps.store.beginSend,finish=this.deps.store.finishSend;if(!begin||!finish)throw Error('mail_store_unavailable');
  const payloadHash=createHash('sha256').update(JSON.stringify([account.id,input.to,input.subject,input.text])).digest('hex');
  const receipt=begin.call(this.deps.store,{requestId:input.requestId,accountId:account.id,revision:account.revision,payloadHash,status:'pending',createdAt:Date.now()},source);if(receipt.status==='accepted'&&receipt.result)return MAIL_SEND_RESULT_SCHEMA.parse(receipt.result);
  const generation=this.generation.get(account.id)??0;let submitted=false;
  const assertSubmission=()=>{const current=this.account(account.id,source);if(!current.allowSend||current.revision!==account.revision||(this.generation.get(account.id)??0)!==generation)throw Error('mail_account_changed');submitted=true;};
  try{const result=MAIL_SEND_RESULT_SCHEMA.parse({...await this.sender.send(account,input,assertSubmission),requestId:input.requestId});finish.call(this.deps.store,input.requestId,payloadHash,'accepted',source,result);return result;}
  catch(error){const uncertain=submitted&&!(error instanceof MailSubmissionRejected);try{finish.call(this.deps.store,input.requestId,payloadHash,uncertain?'unknown':'rejected',source);}catch{throw Error('mail_send_unknown');}if(uncertain)throw Error('mail_send_unknown');throw mailError(error);}
 }
 getSendReceipt(requestId:string,source:MailRequestSource){requireMailUser(source);return this.deps.store.getSendReceipt?.(requestId);}
 getOAuthState(){return this.oauth.getState();}
 beginOAuth(raw:MailOAuthInput,source:MailRequestSource){requireMailUser(source);const input=MAIL_OAUTH_INPUT_SCHEMA.parse(raw);if(input.accountId&&this.account(input.accountId,'user').revision!==input.expectedRevision)throw Error('mail_stale_account');return this.oauth.start(input,'user');}
 cancelOAuth(operationId:string|undefined,source:MailRequestSource){requireMailUser(source);return this.oauth.cancel(operationId,'user');}
 dispose():void{this.disposed=true;this.oauth.dispose();this.reader.close();this.sender.close();this.oauthReader.close();}
}

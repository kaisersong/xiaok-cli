import { MailSubmissionRejected } from './mail-send-errors.js';
import { composeMail } from './mail-smtp-sender.js';
import { simpleParser } from 'mailparser';
import type { MailAccountRecord } from './mail-account-store.js';
import type { MailOAuthInput,MailMessageDto,MailSearchInput,MailSearchResult,MailReadInput,MailReadResult,MailSendInput,MailSendResult } from '../shared/mail-connectors-ipc-contract.js';
import type { MailReader } from './mail-imap-reader.js';
const GMAIL='https://gmail.googleapis.com/gmail/v1/users/me',GRAPH='https://graph.microsoft.com/v1.0';
const cap=(s:unknown,n=1000)=>typeof s==='string'?s.slice(0,n):'';
type Json=Record<string,any>;
/** Only fixed provider endpoints, no renderer-supplied URLs. */
export class OAuthMailReader implements MailReader {
 private readonly tokens=new Map<string,{token:string;expires:number;scopes:string[];revision:number;epoch:number}>();private readonly epochs=new Map<string,number>();private readonly requests=new Map<AbortController,string|undefined>();private readonly refreshes=new Map<string,{epoch:number;revision:number;promise:Promise<string>}>();
 constructor(private readonly deps:{fetch?:typeof fetch;onRefresh?:(account:MailAccountRecord,token:string)=>void}={}){}
 close(id?:string):void{if(id){this.tokens.delete(id);this.epochs.set(id,(this.epochs.get(id)??0)+1);for(const [request,accountId]of this.requests)if(accountId===id)request.abort();}else{this.tokens.clear();for(const key of this.epochs.keys())this.epochs.set(key,this.epochs.get(key)!+1);for(const request of this.requests.keys())request.abort();}}
 private async request(url:string,options:RequestInit={},signal?:AbortSignal,accountId?:string,allowAccepted=false,submission=false):Promise<Json>{
  const abort=new AbortController();this.requests.set(abort,accountId);
  try{const response=await (this.deps.fetch??fetch)(url,{...options,redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000),...(signal?[signal]:[])])});
   if(!response.ok){if(submission&&[400,401,403,404,405,413,415,422,429].includes(response.status))throw new MailSubmissionRejected(response.status===401||response.status===403?'mail_send_reauthorize':'mail_send_rejected');if(response.status===401||response.status===403)throw Error('mail_needs_reconnect');if(response.status===400)throw Error('mail_authorization_failed');throw Error('mail_network_error');}
   if(allowAccepted&&response.status===202)return {};
   if(!response.body)throw Error('mail_network_error');const reader=response.body.getReader();let count=0;const chunks:Uint8Array[]=[];
   for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>1024*1024){await reader.cancel();throw Error('mail_read_limit');}chunks.push(value);}
   const data=JSON.parse(Buffer.concat(chunks).toString());if(!data||typeof data!=='object'||Array.isArray(data)||data.error)throw Error('mail_authorization_failed');return data;
  }finally{this.requests.delete(abort);}
 }
 async authorize(input:MailOAuthInput,code:string,verifier:string,redirectUri:string,signal:AbortSignal):Promise<{email:string;refreshToken:string;sendAuthorized:boolean}>{
  const google=input.provider==='gmail';const body=new URLSearchParams({client_id:input.clientId,code,code_verifier:verifier,redirect_uri:redirectUri,grant_type:'authorization_code',...(input.clientSecret?{client_secret:input.clientSecret}:{})});
  const token=await this.request(google?'https://oauth2.googleapis.com/token':'https://login.microsoftonline.com/common/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body},signal);
  if(typeof token.scope!=='string'||!(google?token.scope.split(/\s+/).includes('https://www.googleapis.com/auth/gmail.readonly'):token.scope.split(/\s+/).some((s:string)=>s==='Mail.Read'||s==='https://graph.microsoft.com/Mail.Read'))||typeof token.access_token!=='string'||typeof token.refresh_token!=='string'||token.refresh_token.length>16384)throw Error('mail_authorization_failed');
  const sendScope=google?'https://www.googleapis.com/auth/gmail.send':'Mail.Send';const sendAuthorized=token.scope.split(/\s+/).some((scope:string)=>scope===sendScope||scope===`https://graph.microsoft.com/${sendScope}`);if(input.allowSend&&!sendAuthorized)throw Error('mail_authorization_failed');
  const profile=await this.request(google?`${GMAIL}/profile`:`${GRAPH}/me?$select=mail,userPrincipalName`,{headers:{Authorization:`Bearer ${token.access_token}`}},signal);const email=google?profile.emailAddress:profile.mail??profile.userPrincipalName;
  if(!google)await this.request(`${GRAPH}/me/mailFolders/inbox?$select=id`,{headers:{Authorization:`Bearer ${token.access_token}`}},signal);
  if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw Error('mail_authorization_failed');return {email:email.toLowerCase(),refreshToken:token.refresh_token,sendAuthorized};
 }
 private async token(account:MailAccountRecord):Promise<string>{
  const cached=this.tokens.get(account.id);if(cached&&cached.expires>Date.now()+60000&&cached.revision===account.revision&&cached.epoch===(this.epochs.get(account.id)??0))return cached.token;
  const epoch=this.epochs.get(account.id)??0,pending=this.refreshes.get(account.id);if(pending&&pending.epoch===epoch&&pending.revision===account.revision)return pending.promise;
  const promise=this.refreshToken(account);this.refreshes.set(account.id,{epoch,revision:account.revision,promise});
  try{return await promise;}finally{if(this.refreshes.get(account.id)?.promise===promise)this.refreshes.delete(account.id);}
 }
 private async refreshToken(account:MailAccountRecord):Promise<string>{
  if(account.auth.kind!=='oauth')throw Error('mail_invalid_input');const cached=this.tokens.get(account.id);if(cached&&cached.expires>Date.now()+60000)return cached.token;
  const epoch=this.epochs.get(account.id)??0;this.epochs.set(account.id,epoch);const google=account.provider==='gmail';const body=new URLSearchParams({client_id:account.auth.clientId,refresh_token:account.auth.refreshToken,grant_type:'refresh_token',...(account.auth.clientSecret?{client_secret:account.auth.clientSecret}:{})});
  let data:Json;try{data=await this.request(google?'https://oauth2.googleapis.com/token':'https://login.microsoftonline.com/common/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body},undefined,account.id);}catch{throw Error('mail_needs_reconnect');}
  if(this.epochs.get(account.id)!==epoch)throw Error('mail_account_changed');if(typeof data.access_token!=='string'||data.access_token.length>16384)throw Error('mail_needs_reconnect');
  if(typeof data.refresh_token==='string'&&data.refresh_token!==account.auth.refreshToken){if(data.refresh_token.length>16384)throw Error('mail_needs_reconnect');this.deps.onRefresh?.(account,data.refresh_token);}
  this.tokens.set(account.id,{token:data.access_token,expires:Date.now()+Math.min(3600,Number(data.expires_in)||300)*1000,scopes:typeof data.scope==='string'?data.scope.split(/\s+/):[],revision:account.revision,epoch});return data.access_token;
 }
 private async api(account:MailAccountRecord,path:string):Promise<Json>{const token=await this.token(account);return this.request((account.provider==='gmail'?GMAIL:GRAPH)+path,{headers:{Authorization:`Bearer ${token}`,Prefer:'IdType="ImmutableId", outlook.body-content-type="text"'}},undefined,account.id);}
 async send(account:MailAccountRecord,input:MailSendInput,assertSubmission:()=>void):Promise<Omit<MailSendResult,'requestId'>>{
  if(!account.allowSend)throw Error('mail_send_denied');if(account.auth.kind!=='oauth'||!account.auth.sendAuthorized)throw Error('mail_send_reauthorize');const token=await this.token(account),cached=this.tokens.get(account.id),google=account.provider==='gmail';
  const required=google?'https://www.googleapis.com/auth/gmail.send':'Mail.Send';if(!cached||cached.token!==token||cached.revision!==account.revision||cached.epoch!==(this.epochs.get(account.id)??0)||!cached.scopes.some(scope=>scope===required||scope===`https://graph.microsoft.com/${required}`))throw Error('mail_send_reauthorize');
  const body=google?JSON.stringify({raw:(await composeMail(account,input)).toString('base64url')}):JSON.stringify({message:{subject:input.subject,body:{contentType:'Text',content:input.text},toRecipients:input.to.map(address=>({emailAddress:{address}}))},saveToSentItems:true});
  assertSubmission();const result=await this.request(google?`${GMAIL}/messages/send`:`${GRAPH}/me/sendMail`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body},undefined,account.id,!google,true);
  if(google&&(typeof result.id!=='string'||result.id.length>1000))throw Error('mail_send_unknown');return {status:'accepted',...(google?{messageId:result.id}:{}),accepted:input.to,rejected:[]};
 }
 test(a:MailAccountRecord):Promise<unknown>{return this.api(a,a.provider==='gmail'?'/profile':'/me/mailFolders/inbox?$select=id,displayName');}
 private gmailMessage(data:Json):MailMessageDto{
  const headers=Array.isArray(data.payload?.headers)?data.payload.headers:[];const header=(name:string)=>headers.find((h:Json)=>typeof h.name==='string'&&h.name.toLowerCase()===name)?.value;const stamp=new Date(Number(data.internalDate));
  if(typeof data.id!=='string'||data.id.length>1024)throw Error('mail_network_error');return {id:data.id,subject:cap(header('subject')),from:cap(header('from')),receivedAt:Number.isFinite(stamp.getTime())?stamp.toISOString():'',unread:Array.isArray(data.labelIds)&&data.labelIds.includes('UNREAD'),preview:cap(data.snippet,2000)};
 }
 private graphMessage(data:Json):MailMessageDto{if(typeof data.id!=='string'||data.id.length>1024)throw Error('mail_network_error');return {id:data.id,subject:cap(data.subject),from:cap(data.from?.emailAddress?.name?`${data.from.emailAddress.name} <${data.from.emailAddress.address??''}>`:data.from?.emailAddress?.address),receivedAt:cap(data.receivedDateTime,64),unread:data.isRead===false,preview:cap(data.bodyPreview,2000)};}
 async search(a:MailAccountRecord,input:Omit<MailSearchInput,'accountId'>):Promise<MailSearchResult>{
  let since=input.since??new Date(Date.now()-86400000).toISOString(),page='';if(input.cursor){try{const c=JSON.parse(Buffer.from(input.cursor,'base64url').toString());if(c.accountId!==a.id||typeof c.since!=='string'||typeof c.page!=='string'||(input.since&&input.since!==c.since))throw Error();since=c.since;page=c.page;}catch{throw Error('mail_invalid_input');}}
  const time=Date.parse(since);if(!Number.isFinite(time)||time<Date.now()-31*86400000||time>Date.now())throw Error('mail_invalid_input');const limit=input.limit??20;let messages:MailMessageDto[],next='';
  if(a.provider==='gmail'){
   const params=new URLSearchParams({q:`in:inbox after:${Math.floor(time/1000)}`,maxResults:String(limit),...(page?{pageToken:page}:{})});const list=await this.api(a,`/messages?${params}`);if((list.messages===undefined&&list.resultSizeEstimate!==0)||(list.messages!==undefined&&!Array.isArray(list.messages)))throw Error('mail_network_error');const ids=(list.messages??[]).slice(0,limit);
   messages=[];for(const row of ids){if(typeof row.id!=='string')throw Error('mail_network_error');const msg=await this.api(a,`/messages/${encodeURIComponent(row.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);messages.push(this.gmailMessage(msg));}next=typeof list.nextPageToken==='string'?list.nextPageToken:'';
  }else{
   const params=new URLSearchParams({'$filter':`receivedDateTime ge ${new Date(time).toISOString()}`,'$orderby':'receivedDateTime desc','$select':'id,subject,from,receivedDateTime,isRead,bodyPreview','$top':String(limit),...(page?{'$skiptoken':page}:{})});const list=await this.api(a,`/me/mailFolders/inbox/messages?${params}`);if(!Array.isArray(list.value))throw Error('mail_network_error');messages=list.value.slice(0,limit).map((v:Json)=>this.graphMessage(v));
   if(list['@odata.nextLink']){const url=new URL(list['@odata.nextLink']);if(url.origin!=='https://graph.microsoft.com'||url.pathname!=='/v1.0/me/mailFolders/inbox/messages')throw Error('mail_network_error');next=url.searchParams.get('$skiptoken')??'';if(!next)throw Error('mail_network_error');}
  }
  const cursor=next?Buffer.from(JSON.stringify({accountId:a.id,since,page:next})).toString('base64url'):undefined;if(cursor&&cursor.length>2048)throw Error('mail_read_limit');return {messages,hasMore:Boolean(next),coverage:next?'partial':'complete',...(cursor?{cursor}:{})};
 }
 async read(a:MailAccountRecord,input:Omit<MailReadInput,'accountId'>):Promise<MailReadResult>{
  const data=await this.api(a,a.provider==='gmail'?`/messages/${encodeURIComponent(input.messageId)}?format=full`:`/me/messages/${encodeURIComponent(input.messageId)}?$select=id,subject,from,receivedDateTime,isRead,body,bodyPreview`);let text='',partial=false;
  if(a.provider==='gmail'){
   const walk=(part:Json,depth:number):void=>{if(depth>20){partial=true;return;}if(part.mimeType==='text/plain'&&typeof part.body?.data==='string')text+=Buffer.from(part.body.data,'base64url').toString('utf8')+'\n';for(const child of Array.isArray(part.parts)?part.parts:[])walk(child,depth+1);};walk(data.payload??{},0);
   if(!text){const html:Json[]=[];const scan=(p:Json,d:number):void=>{if(d>20)return;if(p.mimeType==='text/html'&&typeof p.body?.data==='string')html.push(p);for(const c of Array.isArray(p.parts)?p.parts:[])scan(c,d+1);};scan(data.payload??{},0);if(html.length){const raw=Buffer.from(html[0].body.data,'base64url');text=(await simpleParser(Buffer.concat([Buffer.from('Content-Type: text/html; charset=utf-8\r\n\r\n'),raw]),{skipTextToHtml:true,skipImageLinks:true})).text??'';}else {text=cap(data.snippet,12000);partial=true;}}
  }else if(typeof data.body?.content==='string'){text=data.body.contentType?.toLowerCase()==='html'?(await simpleParser(`Content-Type: text/html; charset=utf-8\r\n\r\n${data.body.content}`,{skipTextToHtml:true,skipImageLinks:true})).text??'':data.body.content;}
  return {...(a.provider==='gmail'?this.gmailMessage(data):this.graphMessage(data)),body:text.slice(0,12000),truncated:partial||text.length>12000};
 }
}

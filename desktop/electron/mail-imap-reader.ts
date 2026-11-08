import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import type { MailAccountRecord } from './mail-account-store.js';
import type { MailMessageDto,MailSearchInput,MailSearchResult,MailReadInput,MailReadResult } from '../shared/mail-connectors-ipc-contract.js';
export interface MailReader {
 test(account:MailAccountRecord):Promise<unknown>;
 search(account:MailAccountRecord,input:Omit<MailSearchInput,'accountId'>):Promise<MailSearchResult>;
 read(account:MailAccountRecord,input:Omit<MailReadInput,'accountId'>):Promise<MailReadResult>;
 close(accountId?:string):void;
}
const cursorSchema=z.object({accountId:z.string(),validity:z.string().regex(/^\d+$/),before:z.number().int().positive(),since:z.string().datetime({offset:true})}).strict();
const cap=(s:unknown,n=1000)=>typeof s==='string'?s.slice(0,n):'';
function message(row:{uid:number;envelope?:{subject?:string;from?:Array<{name?:string;address?:string}>};internalDate?:Date|string;flags?:Set<string>},validity:string):MailMessageDto{
 const date=new Date(row.internalDate??0);
 return {id:`${validity}:${row.uid}`,subject:cap(row.envelope?.subject),from:cap(row.envelope?.from?.map(a=>a.name?`${a.name} <${a.address??''}>`:a.address??'').join(', ')),receivedAt:Number.isFinite(date.getTime())?date.toISOString():'',unread:!row.flags?.has('\\Seen')};
}
export class ImapMailReader implements MailReader {
 private readonly active=new Map<string,Set<ImapFlow>>();
 constructor(private readonly makeClient:(options:ConstructorParameters<typeof ImapFlow>[0])=>ImapFlow=options=>new ImapFlow(options)){}
 close(id?:string):void{for(const [key,clients] of this.active)if(!id||id===key){for(const client of clients)client.close();this.active.delete(key);}}
 private async use<T>(account:MailAccountRecord,work:(client:ImapFlow,validity:string)=>Promise<T>):Promise<T>{
  if(account.auth.kind!=='password')throw Error('mail_invalid_input');
  const client=this.makeClient({host:account.host,port:account.port,secure:true,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},auth:{user:account.email,pass:account.auth.password},logger:false,emitLogs:false,disableAutoIdle:true,disableCompression:true,connectionTimeout:15000,greetingTimeout:10000,socketTimeout:20000,maxLineLength:2*1024*1024,maxLiteralSize:160*1024,clientInfo:{name:'Xiaok',version:'1.0'}});
  client.on('error',()=>{});const set=this.active.get(account.id)??new Set<ImapFlow>();set.add(client);this.active.set(account.id,set);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const operation=(async()=>{await client.connect();const lock=await client.getMailboxLock('INBOX',{readOnly:true});try{if(!client.mailbox||client.mailbox.readOnly!==true)throw Error('mail_invalid_input');return await work(client,String(client.mailbox.uidValidity));}finally{lock.release();}})();
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{client.close();reject(Error('mail_timeout'));},30000);timer.unref?.();})]);}
  finally{if(timer)clearTimeout(timer);try{await Promise.race([client.logout(),new Promise<void>(resolve=>{const t=setTimeout(resolve,500);t.unref?.();})]);}catch{}client.close();set.delete(client);if(set.size===0)this.active.delete(account.id);}
 }
 test(a:MailAccountRecord):Promise<unknown>{return this.use(a,async()=>({ok:true}));}
 search(a:MailAccountRecord,input:Omit<MailSearchInput,'accountId'>):Promise<MailSearchResult>{return this.use(a,async(client,validity)=>{
  const limit=input.limit??20;let since=input.since??new Date(Date.now()-86400000).toISOString(),before=Infinity;
  if(input.cursor){let cursor:z.infer<typeof cursorSchema>;try{cursor=cursorSchema.parse(JSON.parse(Buffer.from(input.cursor,'base64url').toString()));}catch{throw Error('mail_invalid_input');}if(cursor.accountId!==a.id||cursor.validity!==validity)throw Error('mail_message_changed');if(input.since&&input.since!==cursor.since)throw Error('mail_invalid_input');since=cursor.since;before=cursor.before;}
  const date=new Date(since);if(!Number.isFinite(date.getTime())||date.getTime()<Date.now()-31*86400000||date.getTime()>Date.now())throw Error('mail_invalid_input');
  const found=await client.search({since:date},{uid:true});const uids=(Array.isArray(found)?found:[]).filter(uid=>uid<before).sort((x,y)=>y-x);
  if(uids.length>50000)throw Error('mail_read_limit');const selected=uids.slice(0,limit);const rows=selected.length?await client.fetchAll(selected,{uid:true,envelope:true,internalDate:true,flags:true},{uid:true}):[];
  const messages=rows.map(row=>message(row,validity)).filter(row=>Date.parse(row.receivedAt)>=date.getTime()).sort((x,y)=>Date.parse(y.receivedAt)-Date.parse(x.receivedAt));const hasMore=uids.length>selected.length;
  return {messages,hasMore,coverage:hasMore?'partial':'complete',...(hasMore?{cursor:Buffer.from(JSON.stringify({accountId:a.id,validity,before:selected.at(-1),since})).toString('base64url')}:{})};
 });}
 read(a:MailAccountRecord,input:Omit<MailReadInput,'accountId'>):Promise<MailReadResult>{return this.use(a,async(client,validity)=>{
  const match=/^(\d+):([1-9]\d*)$/.exec(input.messageId);if(!match||match[1]!==validity)throw Error('mail_message_changed');const uid=Number(match[2]);if(!Number.isSafeInteger(uid))throw Error('mail_invalid_input');
  const row=await client.fetchOne(uid,{uid:true,envelope:true,internalDate:true,flags:true,size:true,source:{start:0,maxLength:131072}},{uid:true});if(!row||!row.source)throw Error('mail_message_not_found');
  const parsed=await simpleParser(row.source,{skipHtmlToText:false,skipTextToHtml:true,skipImageLinks:true,maxHtmlLengthToParse:131072});const text=parsed.text??'';
  return {...message(row,validity),body:text.slice(0,12000),truncated:(row.size??0)>row.source.length||text.length>12000};
 });}
}

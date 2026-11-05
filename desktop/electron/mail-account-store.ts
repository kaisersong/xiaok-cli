import { existsSync,realpathSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MAIL_ACCOUNT_SCHEMA,MAIL_SEND_RESULT_SCHEMA,type MailAccountDto,type MailRequestSource,type MailSendResult } from '../shared/mail-connectors-ipc-contract.js';
export interface MailSafeStorage {isEncryptionAvailable():boolean;encryptString(text:string):Buffer;decryptString(bytes:Buffer):string;getSelectedStorageBackend?():string}
const auth=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('password'),password:z.string().min(1).max(4096)}).strict(),
 z.object({kind:z.literal('oauth'),clientId:z.string(),clientSecret:z.string().optional(),refreshToken:z.string().min(1).max(16384),sendAuthorized:z.boolean().default(false)}).strict(),
]);
const recordSchema=MAIL_ACCOUNT_SCHEMA.omit({status:true,errorCode:true}).extend({allowSend:z.boolean().default(false),auth}).strict();
// Only the encrypted-file reader accepts the retired read flag. It never becomes a send grant.
const storedRecordSchema=recordSchema.extend({allowAssistant:z.boolean().optional()}).transform(({allowAssistant,...account})=>account);
const receiptSchema=z.object({requestId:z.string().uuid(),accountId:z.string(),revision:z.number().int().positive(),payloadHash:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(['pending','accepted','unknown','rejected']),createdAt:z.number(),result:MAIL_SEND_RESULT_SCHEMA.optional()}).strict();
export type MailSendReceipt=z.infer<typeof receiptSchema>;
const stateSchema=z.object({version:z.literal(1),accounts:z.array(storedRecordSchema).max(50),sends:z.array(receiptSchema).max(1000).default([])}).strict();
export type MailAccountRecord=z.infer<typeof recordSchema>;
export function requireMailUser(source:MailRequestSource|undefined):void{if(source!=='user')throw Error('mail_user_only');}
export interface MailStore {list():MailAccountDto[];get(id:string):MailAccountRecord|undefined;put(account:MailAccountRecord,expectedRevision:number,source:MailRequestSource):void;remove(id:string,expectedRevision:number,source:MailRequestSource):void;rotateRefreshToken?(id:string,revision:number,oldToken:string,newToken:string,source:MailRequestSource):void;beginSend?(receipt:MailSendReceipt,source:MailRequestSource):MailSendReceipt;finishSend?(requestId:string,payloadHash:string,status:'accepted'|'unknown'|'rejected',source:MailRequestSource,result?:MailSendResult):void;getSendReceipt?(requestId:string):MailSendReceipt|undefined}
/** One Main owner. Credentials and the independent send journal are encrypted together. */
export class MailAccountStore implements MailStore {
 private readonly dir:string;private readonly file:string;
 constructor(root:string,private readonly crypto:MailSafeStorage){this.dir=join(existsSync(root)?realpathSync(root):resolve(root),'mail-accounts');this.file=join(this.dir,'accounts.enc');}
 private secure():void{if(!this.crypto.isEncryptionAvailable()||this.crypto.getSelectedStorageBackend?.()==='basic_text')throw Error('mail_secure_storage_unavailable');}
 private checkPath():void{let part=resolve(this.dir);for(;;){if(existsSync(part)&&lstatSync(part).isSymbolicLink())throw Error('mail_store_unavailable');const parent=dirname(part);if(parent===part)break;part=parent;}if(existsSync(this.file)&&(!lstatSync(this.file).isFile()||lstatSync(this.file).isSymbolicLink()))throw Error('mail_store_unavailable');}
 private loadState():z.infer<typeof stateSchema>{this.checkPath();if(!existsSync(this.file))return {version:1,accounts:[],sends:[]};this.secure();try{return stateSchema.parse(JSON.parse(this.crypto.decryptString(readFileSync(this.file))));}catch{throw Error('mail_store_unavailable');}}
 private load():MailAccountRecord[]{return this.loadState().accounts;}
 list():MailAccountDto[]{return this.load().map(a=>({id:a.id,provider:a.provider,email:a.email,host:a.host,port:a.port,allowSend:a.allowSend,...(a.smtpHost?{smtpHost:a.smtpHost,smtpPort:a.smtpPort}:{}),revision:a.revision,...(a.lastVerifiedAt!==undefined?{lastVerifiedAt:a.lastVerifiedAt}:{}),status:'saved'}));}
 get(id:string):MailAccountRecord|undefined{return this.load().find(a=>a.id===id);}
 put(input:MailAccountRecord,expectedRevision:number,source:MailRequestSource):void{requireMailUser(source);this.secure();const a=recordSchema.parse(input),state=this.loadState(),previous=state.accounts.find(x=>x.id===a.id);if((previous?.revision??0)!==expectedRevision||a.revision!==expectedRevision+1)throw Error('mail_stale_account');if(!previous&&state.accounts.length>=50)throw Error('mail_read_limit');this.persist({version:1,accounts:[...state.accounts.filter(x=>x.id!==a.id),a],sends:state.sends});}
 remove(id:string,expectedRevision:number,source:MailRequestSource):void{requireMailUser(source);const state=this.loadState();if(state.accounts.find(a=>a.id===id)?.revision!==expectedRevision)throw Error('mail_stale_account');this.persist({...state,accounts:state.accounts.filter(a=>a.id!==id)});}
 rotateRefreshToken(id:string,revision:number,oldToken:string,newToken:string,source:MailRequestSource):void{if(source!=='scheduler')throw Error('mail_user_only');const state=this.loadState(),account=state.accounts.find(a=>a.id===id);if(!account||account.revision!==revision||account.auth.kind!=='oauth'||account.auth.refreshToken!==oldToken)throw Error('mail_account_changed');if(!newToken||newToken.length>16384)throw Error('mail_invalid_input');account.auth.refreshToken=newToken;this.persist(state);}
 getSendReceipt(requestId:string):MailSendReceipt|undefined{return this.loadState().sends.find(r=>r.requestId===requestId);}
 beginSend(raw:MailSendReceipt,source:MailRequestSource):MailSendReceipt{
  if(!['user','agent','scheduler'].includes(source))throw Error('mail_send_denied');const receipt=receiptSchema.parse(raw);if(receipt.status!=='pending'||receipt.result)throw Error('mail_invalid_input');const state=this.loadState(),account=state.accounts.find(a=>a.id===receipt.accountId);if(!account?.allowSend||account.revision!==receipt.revision)throw Error('mail_send_denied');
  const previous=state.sends.find(r=>r.requestId===receipt.requestId);if(previous){if(previous.accountId!==receipt.accountId||previous.payloadHash!==receipt.payloadHash)throw Error('mail_send_conflict');if(previous.status==='accepted')return previous;throw Error(previous.status==='rejected'?'mail_send_rejected':'mail_send_unknown');}
  if(state.sends.some(r=>r.accountId===receipt.accountId&&r.payloadHash===receipt.payloadHash&&(r.status==='pending'||r.status==='unknown')))throw Error('mail_send_unknown');if(state.sends.length>=1000)throw Error('mail_send_limit');this.persist({...state,sends:[...state.sends,receipt]});return receipt;
 }
 finishSend(requestId:string,payloadHash:string,status:'accepted'|'unknown'|'rejected',source:MailRequestSource,result?:MailSendResult):void{
  if(!['user','agent','scheduler'].includes(source))throw Error('mail_send_denied');const state=this.loadState(),receipt=state.sends.find(r=>r.requestId===requestId&&r.payloadHash===payloadHash);if(!receipt)throw Error('mail_send_unknown');if(receipt.status==='accepted')return;
  receipt.status=status;if(status==='accepted'){const parsed=MAIL_SEND_RESULT_SCHEMA.parse(result);if(parsed.requestId!==requestId)throw Error('mail_send_conflict');receipt.result=parsed;}this.persist(state);
 }
 private persist(state:z.infer<typeof stateSchema>):void{this.secure();this.checkPath();mkdirSync(this.dir,{recursive:true,mode:0o700});this.checkPath();const staged=join(this.dir,`.accounts-${randomUUID()}`);try{const encrypted=this.crypto.encryptString(JSON.stringify(state));writeFileSync(staged,encrypted,{flag:'wx',mode:0o600});renameSync(staged,this.file);}catch{throw Error('mail_store_unavailable');}finally{rmSync(staged,{force:true});}}
}

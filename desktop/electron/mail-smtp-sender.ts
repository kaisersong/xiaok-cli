import SMTPConnection from 'nodemailer/lib/smtp-connection';
import MailComposer from 'nodemailer/lib/mail-composer';
import type { MailAccountRecord } from './mail-account-store.js';
import type { MailSendInput,MailSendResult } from '../shared/mail-connectors-ipc-contract.js';
export interface MailSender {send(account:MailAccountRecord,input:MailSendInput,assertSubmission:()=>void):Promise<Omit<MailSendResult,'requestId'>>;close(id?:string):void}
export async function composeMail(account:MailAccountRecord,input:MailSendInput):Promise<Buffer>{return new MailComposer({from:account.email,to:input.to,subject:input.subject,text:input.text,disableFileAccess:true,disableUrlAccess:true}).compile().build();}
export class MailSmtpSender implements MailSender {
 private readonly active=new Map<SMTPConnection,string>();
 constructor(private readonly makeConnection=(options:SMTPConnection.Options)=>new SMTPConnection(options)){}
 close(id?:string):void{for(const [connection,accountId]of this.active)if(!id||id===accountId)connection.close();}
 async send(account:MailAccountRecord,input:MailSendInput,assertSubmission:()=>void):Promise<Omit<MailSendResult,'requestId'>>{
  if(!account.allowSend)throw Error('mail_send_denied');if(account.auth.kind!=='password')throw Error('mail_invalid_input');
  const host=account.provider==='qq'?'smtp.qq.com':account.provider==='netease163'?'smtp.163.com':account.smtpHost,port=account.provider==='imap'?(account.smtpPort??465):465;if(!host)throw Error('mail_invalid_input');
  const mime=await composeMail(account,input);const connection=this.makeConnection({host,port,secure:port===465,requireTLS:port!==465,tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'},logger:false,debug:false,connectionTimeout:15000,greetingTimeout:10000,socketTimeout:20000});this.active.set(connection,account.id);
  try{return await new Promise((resolve,reject)=>{
   let settled=false;const finish=(error:unknown,result?:Omit<MailSendResult,'requestId'>)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result!);};const timer=setTimeout(()=>{finish(Error('mail_timeout'));connection.close();},45000);timer.unref?.();connection.on('error',error=>finish(error));connection.on('end',()=>finish(Error('mail_account_changed')));
   connection.connect(error=>{if(settled)return;if(error)return finish(error);connection.login({user:account.email,pass:account.auth.kind==='password'?account.auth.password:''},error=>{if(settled)return;if(error)return finish(error);try{assertSubmission();}catch(error){finish(error);connection.close();return;}connection.send({from:account.email,to:input.to},mime,(error,info)=>{if(error)return finish(error);finish(null,{status:'accepted',accepted:(info.accepted??[]).map(String),rejected:(info.rejected??[]).map(String)});});});});
  });}finally{this.active.delete(connection);connection.close();}
 }
}

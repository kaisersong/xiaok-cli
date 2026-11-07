import { createServer,type Server } from 'node:http';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { MAIL_OAUTH_INPUT_SCHEMA,type MailOAuthInput,type MailOAuthState,type MailRequestSource } from '../shared/mail-connectors-ipc-contract.js';
import { requireMailUser } from './mail-account-store.js';
interface Dependencies {openExternal(url:string):Promise<void>;authorize(input:MailOAuthInput,code:string,verifier:string,redirectUri:string,signal:AbortSignal,assertCurrent:()=>void):Promise<(()=>void)|void>}
/** One Main-private OAuth operation; renderer sees status only. */
export class MailOAuthFlow {
 private state:MailOAuthState={phase:'idle'};private job?:{id:string;server:Server;abort:AbortController;timer:ReturnType<typeof setTimeout>};private disposed=false;
 constructor(private readonly deps:Dependencies){}
 getState():MailOAuthState{return {...this.state};}
 private stop(force=true):void{const job=this.job;this.job=undefined;if(job){clearTimeout(job.timer);job.abort.abort();if(force)job.server.closeAllConnections();job.server.close();}}
 dispose():void{this.disposed=true;this.stop();}
 async cancel(operationId:string|undefined,source:MailRequestSource):Promise<MailOAuthState>{requireMailUser(source);if(!this.job)return this.getState();if(operationId&&this.job&&this.job.id!==operationId)throw Error('mail_authorization_cancelled');this.stop();this.state={phase:'cancelled',...(operationId?{operationId}:{})};return this.getState();}
 async start(raw:MailOAuthInput,source:MailRequestSource):Promise<MailOAuthState>{
  requireMailUser(source);const input=MAIL_OAUTH_INPUT_SCHEMA.parse(raw);if(this.disposed)throw Error('mail_authorization_cancelled');if(this.job)throw Error('mail_authorization_busy');
  const operationId=randomUUID(),state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');const challenge=createHash('sha256').update(verifier).digest('base64url');let redirectUri='';let consumed=false;
  const abort=new AbortController();const server=createServer((req,res)=>{
   const url=new URL(req.url??'/','http://127.0.0.1');res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'");
   if(req.method!=='GET'||url.pathname!=='/oauth/callback'||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==state||url.searchParams.getAll('code').length>1||consumed||this.job?.id!==operationId){res.statusCode=400;res.end('Invalid authorization request.');return;}
   consumed=true;const code=url.searchParams.get('code');if(!code||code.length>4096||url.searchParams.get('error')){res.end('Authorization was not completed.');this.state={phase:'failed',operationId,errorCode:'mail_authorization_failed'};this.stop();return;}
   this.state={phase:'exchanging',operationId};const assertCurrent=()=>{if(this.disposed||this.job?.id!==operationId||abort.signal.aborted)throw Error('mail_authorization_cancelled');};
   void this.deps.authorize(input,code,verifier,redirectUri,abort.signal,assertCurrent).then(commit=>{assertCurrent();commit?.();this.state={phase:'connected',operationId};res.end('Email connected. You can return to Xiaok.');this.stop(false);}).catch(()=>{if(this.job?.id===operationId){this.state={phase:'failed',operationId,errorCode:'mail_authorization_failed'};res.end('Could not connect email. Return to Xiaok to try again.');this.stop();}else res.destroy();});
  });
  const timer=setTimeout(()=>{if(this.job?.id===operationId){this.state={phase:'timed_out',operationId,errorCode:'mail_timeout'};this.stop();}},120000);timer.unref?.();this.job={id:operationId,server,abort,timer};this.state={phase:'waiting',operationId};
  try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});if(this.job?.id!==operationId)throw Error('mail_authorization_cancelled');const address=server.address();if(!address||typeof address==='string')throw Error('mail_authorization_failed');redirectUri=`http://127.0.0.1:${address.port}/oauth/callback`;
   const url=new URL(input.provider==='gmail'?'https://accounts.google.com/o/oauth2/v2/auth':'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
   const params={client_id:input.clientId,redirect_uri:redirectUri,response_type:'code',state,code_challenge:challenge,code_challenge_method:'S256',scope:input.provider==='gmail'?`https://www.googleapis.com/auth/gmail.readonly${input.allowSend?' https://www.googleapis.com/auth/gmail.send':''}`:`openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read${input.allowSend?' https://graph.microsoft.com/Mail.Send':''}`};for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
   if(input.provider==='gmail'){url.searchParams.set('access_type','offline');url.searchParams.set('prompt','consent');}await this.deps.openExternal(url.href);if(this.state.operationId===operationId&&this.state.phase==='connected')return this.getState();if(this.job?.id!==operationId)throw Error('mail_authorization_cancelled');return this.getState();
  }catch{if(this.job?.id===operationId){this.state={phase:'failed',operationId,errorCode:'mail_authorization_failed'};this.stop();}throw Error('mail_authorization_failed');}
 }
}

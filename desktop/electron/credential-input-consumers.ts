import {createHash,randomUUID} from 'node:crypto';
import {loadConfigSync,updateConfigCredential} from '../../src/utils/config.js';
import type {Config} from '../../src/types.js';
import {getProviderProfile} from '../../src/ai/providers/registry.js';
import type {MailConnectorService} from './mail-connector-service.js';
import type {MailAccountDto} from '../shared/mail-connectors-ipc-contract.js';
import {ConnectorsStore} from './connectors-store.js';
import {CredentialInputService,type BoundCredentialTarget} from './credential-input-service.js';
const fingerprint=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const destination=(raw:string)=>{try{const u=new URL(raw);return u.origin+u.pathname;}catch{return 'configured-service';}};
const mailFingerprint=(a:MailAccountDto)=>fingerprint([a.id,a.provider,a.email,a.host,a.port,a.revision,a.allowSend,a.smtpHost,a.smtpPort]);
const slots=[['search','tavilyApiKey','Tavily','https://api.tavily.com'],['search','braveApiKey','Brave Search','https://api.search.brave.com'],['search','firecrawlApiKey','Firecrawl','https://api.firecrawl.dev'],['fetch','jinaApiKey','Jina Reader','https://r.jina.ai'],['fetch','firecrawlApiKey','Firecrawl','https://api.firecrawl.dev']] as const;
function models(config:Config):BoundCredentialTarget[]{return Object.entries(config.providers).slice(0,50).map(([id,p])=>({id:'model:'+id,kind:'model',label:(getProviderProfile(id)?.label??id).slice(0,200),destination:destination(p.baseUrl??getProviderProfile(id)?.baseUrl??''),fingerprint:fingerprint(p)}));}
/** No endpoint/path comes from the tool. All consumers are fixed Main operations. */
export function createCredentialInputOwner(d:{dataRoot:string;mail:MailConnectorService;refreshConnectors():Promise<void>;changed():void}){
 const connectors=new ConnectorsStore({dataRoot:d.dataRoot});
 const targets=():BoundCredentialTarget[]=>{const config=loadConfigSync(),search=connectors.load().config;return [...models(config),...slots.map(([part,field,label,url])=>({id:`connector:${part}:${field}`,kind:'connector' as const,label,destination:destination(part==='fetch'&&field==='firecrawlApiKey'?(search.fetch.firecrawlBaseUrl??url):url),fingerprint:fingerprint(search)})),...d.mail.list().filter(a=>['qq','netease163','imap'].includes(a.provider)).map(a=>({id:'mail:'+a.id,kind:'mail' as const,label:a.provider,account:a.email,destination:`${a.host}:${a.port}`,fingerprint:mailFingerprint(a)}))];};
 return new CredentialInputService({targets,changed:d.changed,apply:async(target,value,signal)=>{
   signal.throwIfAborted();
   if(target.kind==='model'){const id=target.id.slice('model:'.length);await updateConfigCredential(config=>{const current=models(config).find(t=>t.id===target.id);if(!current||current.fingerprint!==target.fingerprint)throw Error('credential_target_changed');return {...config,providers:{...config.providers,[id]:{...config.providers[id],apiKey:value}}};},signal);}
   else if(target.kind==='connector'){const slot=slots.find(([part,field])=>target.id===`connector:${part}:${field}`);if(!slot)throw Error('credential_target_unavailable');const current=connectors.load().config;if(fingerprint(current)!==target.fingerprint)throw Error('credential_target_changed');await connectors.replaceCredential(slot[0],slot[1],value,JSON.stringify(current),{requestSource:'user'},signal);await d.refreshConnectors();}
   else {const a=d.mail.list().find(a=>'mail:'+a.id===target.id);if(!a||mailFingerprint(a)!==target.fingerprint||!['qq','netease163','imap'].includes(a.provider))throw Error('credential_target_changed');await d.mail.connect({provider:a.provider as 'qq'|'netease163'|'imap',email:a.email,password:value,expectedRevision:a.revision,allowSend:a.allowSend,...(a.provider==='imap'?{host:a.host,port:a.port,...(a.smtpHost?{smtpHost:a.smtpHost,smtpPort:a.smtpPort}:{})}:{})},'user',signal);}
   return 'credential:'+randomUUID();
 }});
}

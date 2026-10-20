import type { ContextMcpStatus } from '../../shared/context-continuity-types.js';
import type { ContinuityService, ContinuityActor } from './service.js';
import type { IssueExternalReaderInput } from './external-readers.js';
import { ContinuityMcpEndpoint } from './mcp.js';

/** All changes are serialized by the main owner; neither reading status nor issuing a URL grants access. */
export class ContinuityMcpController {
  private endpoint:ContinuityMcpEndpoint|null=null;
  private url:string|null=null;
  private stopped=false;
  private changes:Promise<unknown>=Promise.resolve();
  constructor(private readonly service:ContinuityService,private readonly actor:ContinuityActor,private readonly refresh?:()=>Promise<void>,private readonly ready:()=>boolean=()=>true){}
  status():ContextMcpStatus{
    this.service.assertActor(this.actor,true);
    const enabled=this.service.store.db.prepare("SELECT value FROM continuity_meta WHERE key='mcpEnabled'").get()?.value==='true';
    return {enabled,state:this.url?'listening':enabled?'unavailable':'disabled',url:this.url};
  }
  private serial<T>(fn:()=>Promise<T>):Promise<T>{const pending=this.changes.then(fn);this.changes=pending.catch(()=>undefined);return pending;}
  private async enable():Promise<ContextMcpStatus>{
    if(this.stopped)throw new Error('continuity_stopping');if(!this.ready())throw new Error('continuity_not_ready');
    this.service.assertActor(this.actor,true);if(this.endpoint&&this.url)return this.status();
    const saved=this.service.store.db.prepare("SELECT value FROM continuity_meta WHERE key='mcpPort'").get();
    const port=saved?Number(saved.value):0;
    const endpoint=new ContinuityMcpEndpoint({service:this.service,refresh:this.refresh});
    try{
      const url=await endpoint.start(port);
      this.service.store.transaction(()=>{const write=this.service.store.db.prepare('INSERT OR REPLACE INTO continuity_meta VALUES (?,?)');write.run('mcpPort',new URL(url).port);write.run('mcpEnabled','true');});
      this.endpoint=endpoint;this.url=url;return this.status();
    }catch(error){await endpoint.close();throw error;}
  }
  setEnabled(enabled:boolean):Promise<ContextMcpStatus>{return this.serial(async()=>{
    if(enabled)return this.enable();this.service.assertActor(this.actor,true);
    this.service.store.db.prepare('INSERT OR REPLACE INTO continuity_meta VALUES (?,?)').run('mcpEnabled','false');
    const endpoint=this.endpoint;this.endpoint=null;this.url=null;await endpoint?.close();return this.status();
  });}
  restore():Promise<void>{return this.serial(async()=>{if(this.status().enabled)await this.enable();});}
  resetPort():Promise<ContextMcpStatus>{return this.serial(async()=>{
    if(this.stopped||!this.ready())throw new Error('continuity_not_ready');this.service.assertActor(this.actor,true);
    const endpoint=this.endpoint;this.endpoint=null;this.url=null;await endpoint?.close();
    this.service.store.transaction(()=>{
      this.service.store.db.exec('UPDATE external_readers SET revoked=1; UPDATE external_reader_dependencies SET valid=0;');
      this.service.store.db.prepare("DELETE FROM continuity_meta WHERE key='mcpPort'").run();
      this.service.store.db.prepare('INSERT OR REPLACE INTO continuity_meta VALUES (?,?)').run('mcpEnabled','false');
    });
    return this.enable();
  });}
  issue(input:IssueExternalReaderInput):Promise<{credentialId:string;clientConfig:string}>{return this.serial(async()=>{
    const state=await this.enable(),issued=this.service.issueExternalReader(this.actor,input);
    return {credentialId:issued.credentialId,clientConfig:JSON.stringify({mcpServers:{'xiaok-context':{type:'http',url:state.url,headers:{Authorization:`Bearer ${issued.secret}`}}}},null,2)};
  });}
  async close():Promise<void>{this.stopped=true;await this.changes;const endpoint=this.endpoint;this.endpoint=null;this.url=null;await endpoint?.close();}
}

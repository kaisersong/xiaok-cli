import type {Config} from '../../types.js';
import {loadConfig,saveConfig} from '../../utils/config.js';
import {KimDecisionClient} from './client.js';
import {applyKimDecisionPatch,resolveKimDecisionConfig,kimConfigView,type ResolvedKimConfig} from './config.js';
import type {KimConfigPatch,KimWindow} from './contracts.js';
export interface KimLease {config:ResolvedKimConfig;generation:number}
export class KimDecisionRuntime {
 private generation=0;private writing:Promise<unknown>=Promise.resolve();
 readonly client:KimDecisionClient;
 constructor(private readonly deps:{load():Promise<Config>;save(config:Config):Promise<void>;client?:KimDecisionClient}){this.client=deps.client??new KimDecisionClient();}
 async begin():Promise<KimLease>{await this.writing.catch(()=>{});const config=resolveKimDecisionConfig(await this.deps.load());return {config,generation:this.generation};}
 async view(){return kimConfigView((await this.begin()).config);}
 async save(patch:KimConfigPatch,source?:'user'|'agent'|'scheduler'){
  if(source!=='user')throw Error('kim_config_user_required');
  const previous=this.writing;const operation=(async()=>{await previous.catch(()=>{});const c=await this.deps.load();applyKimDecisionPatch(c,patch);await this.deps.save(c);this.generation++;return kimConfigView(resolveKimDecisionConfig(c));})();this.writing=operation;return operation;
 }
 async current(lease:KimLease):Promise<boolean>{const current=await this.begin();return this.currentSync(lease)&&JSON.stringify(current.config)===JSON.stringify(lease.config);}
 currentSync(lease:KimLease){return lease.generation===this.generation;}
 async judge(windows:KimWindow[],signal:AbortSignal,lease?:KimLease){const bound=lease??await this.begin();if(!bound.config.enabled)throw Error('kim_disabled');const result=await this.client.judge(windows,bound.config.baseUrl,signal);signal.throwIfAborted();if(!await this.current(bound))throw Error('kim_config_changed');signal.throwIfAborted();return result;}
 async health(signal=new AbortController().signal){const {config}=await this.begin();try{return await this.client.health(config.baseUrl,signal);}catch(e){return {available:false,model:'Songkai/K-IM-Deiction' as const,errorCode:e instanceof Error&&/^kim_[a-z0-9_]+$/.test(e.message)?e.message:'kim_unavailable'};}}
}
export const defaultKimDecisionRuntime=new KimDecisionRuntime({load:loadConfig,save:saveConfig});

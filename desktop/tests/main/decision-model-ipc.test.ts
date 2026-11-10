// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerDecisionModelIpc} from '../../electron/decision-model-ipc.js';
import {getDecisionModelService} from '../../electron/decision-model-service.js';
const stock:Array<{root:string;service:ReturnType<typeof getDecisionModelService>;release:()=>void}>=[];
afterEach(async()=>{const errors:unknown[]=[];for(const row of stock.splice(0)){row.release();try{await row.service.dispose();rmSync(row.root,{recursive:true,force:true});}catch(raw){errors.push(raw);}}if(errors.length)throw new AggregateError(errors,'decision_ipc_cleanup');});
function setup(){
 const root=mkdtempSync(join(tmpdir(),'decision-ipc-')),trusted=Object.freeze({fixture:'original-main-window'}),listeners=new Map<string,Function>();
 let revocation=false,calls=0;let release:()=>void=()=>undefined;
 const registrar={handle:(channel:string,listener:Function)=>{listeners.set(channel,listener);}};
 registerDecisionModelIpc({registrar:registrar as never,dataRoot:root,
  authorize:event=>{calls++;return (event as unknown)===trusted&&!revocation?{actorId:'desktop-user:fixture'}:null;},
  window:()=>({isDestroyed:()=>true}) as never,registerDisposer:fn=>{release=fn;}});
 const service=getDecisionModelService(root);stock.push({root,service,release});
 return {root,trusted,service,invoke:(name:string,event:unknown,...args:unknown[])=>listeners.get('desktop:'+name)!(event,...args),revoke:()=>{revocation=true;},calls:()=>calls};
}
describe('fixed manual manager IPC scheduling, no Native identity proof',()=>{
 it('denies an untrusted event before any model/config mutation',async()=>{
  const f=setup();await expect(f.invoke('decisionModelsDownload',{},'clef-flash-mlx-4bit')).rejects.toThrow('unauthorized_sender');expect(readdirSync(f.root)).toEqual([]);
 });
 it('does not accept an actor or user source from the transport payload',async()=>{
  const f=setup();await expect(f.invoke('decisionModelsStart',{}, {modelId:'clef-flash-mlx-4bit',approveCommunityCode:true,actorId:'desktop-user:fixture',requestSource:'user'})).rejects.toThrow('unauthorized_sender');expect(readdirSync(f.root)).toEqual([]);
 });
 it('rejects caller namespace/provider/path flags on the original authorized route',async()=>{
  const f=setup();await expect(f.invoke('decisionModelsStart',f.trusted,{modelId:'clef-flash-mlx-4bit',approveCommunityCode:true,namespace:{known:true},provider:{},path:'/tmp/caller'})).rejects.toBeDefined();expect(readdirSync(f.root)).toEqual([]);
 });
 it('validates the exact model ID after current Main authorization',async()=>{
  const f=setup();await expect(f.invoke('decisionModelsDownload',f.trusted,'../escape')).rejects.toBeDefined();expect(readdirSync(f.root)).toEqual([]);
 });
 it('returns the actual fixed read projection and never enables memory rerank',async()=>{
  const f=setup();const result=await f.invoke('decisionModelsList',f.trusted);expect(result).toHaveLength(2);expect(result.every((v:Record<string,unknown>)=>v.automaticMemoryRerank==='not-qualified-r12')).toBe(true);expect(f.calls()).toBe(2);expect(readdirSync(f.root)).toEqual([]);
 });
 it('rechecks the same private sender before delivering an admitted result',async()=>{
  const f=setup();const original=f.service.list.bind(f.service);f.service.list=async()=>{const value=await original();f.revoke();return value;};
  await expect(f.invoke('decisionModelsList',f.trusted)).rejects.toThrow('unauthorized_sender');expect(f.calls()).toBe(2);
 });
});

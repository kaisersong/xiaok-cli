// @vitest-environment node
import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const roots:string[]=[];
const active:Array<{dispose():Promise<void>}>=[];
function root(){const p=mkdtempSync(join(tmpdir(),'decision-manager-'));roots.push(p);return p;}
async function manager(path=root()) {
  // The import is in the case: the absent original feature is a true case RED,
  // not a collection failure or a replacement implementation in the fixture.
  const {DecisionModelService}=await import('../../electron/decision-model-service.js');
  const service=new DecisionModelService(path);active.push(service);return service;
}
afterEach(async()=>{
 const errors:unknown[]=[];
 for(const s of active.splice(0)){try{await s.dispose();}catch(raw){errors.push(raw);}}
 for(const p of roots.splice(0)){try{rmSync(p,{recursive:true,force:true});}catch(raw){errors.push(raw);}}
 if(errors.length)throw new AggregateError(errors,'decision_manager_test_cleanup');
});
describe('manual decision manager user boundary and selection',()=>{
 it('lists the fixed catalogue without downloading or starting anything',async()=>{
  const p=root(),s=await manager(p),views=await s.list();
  expect(views.map(v=>v.id)).toEqual(['clef-flash-mlx-4bit','laya-multilingual']);
  expect(views.every(v=>v.state==='not_installed'&&!v.selected&&v.automaticMemoryRerank==='not-qualified-r12')).toBe(true);
  expect(readdirSync(p)).toEqual([]);
 });
 it('rejects agent mutation before creating any model tree',async()=>{
  const p=root(),s=await manager(p);
  await expect(s.download('clef-flash-mlx-4bit',{requestSource:'agent'})).rejects.toThrow('user_only');
  expect(readdirSync(p)).toEqual([]);
 });
 it('rejects scheduler mutation before creating any model tree',async()=>{
  const p=root(),s=await manager(p);
  await expect(s.remove('clef-flash-mlx-4bit',{requestSource:'scheduler'})).rejects.toThrow('user_only');
  expect(readdirSync(p)).toEqual([]);
 });
 it('denies unknown model IDs without interpreting them as paths',async()=>{
  const p=root(),s=await manager(p);
  await expect(s.download('../escape',{requestSource:'user'})).rejects.toThrow('unknown_model');
  expect(readdirSync(p)).toEqual([]);
 });
 it('requires explicit community-code approval before runtime entry',async()=>{
  const p=root(),s=await manager(p);
  await expect(s.start('clef-flash-mlx-4bit',false,{requestSource:'user'})).rejects.toThrow('runtime_approval_required');
  expect(readdirSync(p)).toEqual([]);
 });
 it('does not persist a claimed ready selection for an unstarted model',async()=>{
  const p=root(),s=await manager(p);
  await expect(s.use('clef-flash-mlx-4bit',{requestSource:'user'})).rejects.toThrow('model_unavailable');
  expect(readdirSync(p)).toEqual([]);
 });
 it('retains a legacy requested choice while refusing legacy enabled execution',async()=>{
  const p=root();writeFileSync(join(p,'memory-jev-settings.json'),JSON.stringify({version:1,enabled:true,generation:'00000000-0000-4000-8000-000000000000',decision:{provider:'local-systemone',managedModelId:'clef-flash-mlx-4bit',endpoint:'http://127.0.0.1:1234/v1/systemone',model:'clef-flash-mlx-4bit',profile:'clef-helper-maxprob-v1'}}));
  const s=await manager(p),views=await s.list();
  expect(views.find(v=>v.id==='clef-flash-mlx-4bit')?.selected).toBe(true);
  expect(views.every(v=>v.automaticMemoryRerank==='not-qualified-r12'&&v.state==='not_installed')).toBe(true);
  expect(readdirSync(p)).toEqual(['memory-jev-settings.json']);
 });
 it('seals new effects synchronously and keeps original disposal idempotent',async()=>{
  const p=root(),s=await manager(p);s.beginShutdown();
  await expect(s.download('clef-flash-mlx-4bit',{requestSource:'user'})).rejects.toThrow('closed');
  await s.dispose();await s.dispose();expect(readdirSync(p)).toEqual([]);
 });
 it('rejects non-user selection even if the ID is on the fixed catalogue',async()=>{
  const p=root(),s=await manager(p);
  await expect(s.use('clef-flash-mlx-4bit',{requestSource:'agent'})).rejects.toThrow('user_only');
  expect(readdirSync(p)).toEqual([]);
 });
});

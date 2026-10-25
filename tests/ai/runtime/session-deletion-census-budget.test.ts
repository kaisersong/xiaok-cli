import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,renameSync,lstatSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
const fault=vi.hoisted(()=>({path:'',swapped:false}));
vi.mock('node:fs',async original=>{const fs=await original<typeof import('node:fs')>();
 const swap=()=>{fault.swapped=true;const bytes=fs.readFileSync(fault.path);fs.renameSync(fault.path,fault.path+'.old');fs.writeFileSync(fault.path,bytes);};
 return {...fs,readFileSync(...args:Parameters<typeof fs.readFileSync>){const value=fs.readFileSync(...args);if(fault.path&&!fault.swapped&&String(args[0])===fault.path)swap();return value;},readSync(...args:Parameters<typeof fs.readSync>){
 const count=fs.readSync(...args);
 if(fault.path&&!fault.swapped&&fs.fstatSync(args[0]).ino===fs.lstatSync(fault.path).ino)swap();
 return count;
}};});
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {AgentSessionState} from '../../../src/ai/runtime/session.js';
const roots:string[]=[];afterEach(()=>{fault.path='';fault.swapped=false;for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it.each(['oversize','aggregate','target-plus-sibling','entry-count','repeated-entry-count','replacement'] as const)('actual deletion refuses %s census before requesting a receipt',async kind=>{
 const root=mkdtempSync(join(tmpdir(),'delete-budget-'));roots.push(root);const store=new FileSessionStore(root);
 await store.save({...new AgentSessionState().exportSnapshot(),sessionId:'source',protectedObservationClosure:{version:1,requiresReauthorization:true,observations:[]}});
 const original=JSON.parse(readFileSync(join(root,'source.json'),'utf8'));let receipts=0;
 if(kind==='target-plus-sibling'){const expanded={...original,historyDigest:undefined,messages:[{role:'assistant',content:[{type:'text',text:'x'.repeat(9*1024*1024)}]}]};writeFileSync(join(root,'source.json'),JSON.stringify(expanded));}
 if(kind==='entry-count'||kind==='repeated-entry-count')for(let i=0;i<(kind==='entry-count'?4096:2050);i++)writeFileSync(join(root,`ordinary-${i}.txt`),'');
 for(let index=0;index<(kind==='aggregate'?2:1);index++){
  const sessionId=`sibling_${index}`,bytes=kind==='oversize'?17*1024*1024:kind==='aggregate'?9*1024*1024:kind==='target-plus-sibling'?8*1024*1024:128;
  const value={...original,sessionId,historyDigest:undefined,protectedObservationClosure:undefined,messages:[{role:'assistant',content:[{type:'text',text:'x'.repeat(bytes)}]}]};
  writeFileSync(join(root,sessionId+'.json'),JSON.stringify(value));
 }
 if(kind==='replacement')fault.path=join(root,'sibling_0.json');
 await expect(store.deleteSession({requestSource:'user',sessionId:'source',receipts:{begin(){receipts++;return 'a'.repeat(64);},complete(){}}})).rejects.toThrow(/census|budget|changed/);
 if(kind==='replacement')expect(fault.swapped).toBe(true);
 expect(receipts).toBe(0);expect(lstatSync(join(root,'source.json')).isFile()).toBe(true);
});

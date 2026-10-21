// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { compileProtectionWorkerEntry } from '../fixtures/desktop-protection-worker-entry.js';
let compiled: Awaited<ReturnType<typeof compileProtectionWorkerEntry>>;
const scratch=mkdtempSync(join(tmpdir(),'protection-build-test-'));
beforeAll(async()=>{compiled=await compileProtectionWorkerEntry();},10000);
afterAll(()=>{if(compiled)rmSync(compiled.root,{recursive:true,force:true});rmSync(scratch,{recursive:true,force:true});});
const sha=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
describe('fresh actual protection worker compilation',()=>{
  it('records strict actual transitive compiler inputs and every emitted sibling before publishing the entry',()=>{
    const result=compiled as typeof compiled & {compilation:{roots:string[];noCheck:false;firstReadHashes:Record<string,string>;emittedOutputs:Record<string,string>;readDrift:string[]}};
    expect(result.compilation).toBeDefined();
    expect(result.compilation.noCheck).toBe(false);expect(result.compilation.readDrift).toEqual([]);
    for(const name of ['protection-read-worker','protection-read-worker-body','protected-observation-store']){
      const source=fileURLToPath(new URL('../../../src/runtime/task-host/'+name+'.ts',import.meta.url));
      expect(result.compilation.roots).toContain(source);
      expect(result.compilation.firstReadHashes[source]).toBe(sha(source));
      const emitted=join(compiled.root,'runtime/task-host',name+'.js');
      expect(result.compilation.emittedOutputs[emitted]).toBe(sha(emitted));
    }
    for(const [file,hash]of Object.entries(result.compilation.firstReadHashes))expect(sha(file)).toBe(hash);
    for(const [file,hash]of Object.entries(result.compilation.emittedOutputs))expect(sha(file)).toBe(hash);
    expect(result.audit.length).toBeGreaterThan(0);
    for(const input of result.audit)expect(input.originalUrl).toBe(pathToFileURL(input.file).href);
  });
  it.each(['missing-task',''])('starts the actual emitted conditional body and exits after its real read response for %s',async taskId=>{
    const worker=new Worker(compiled.output,{workerData:{root:scratch,canonicalRoot:join(scratch,'canonical'),taskId}});
    const message=once(worker,'message'),exit=once(worker,'exit');
    try{expect((await message)[0]).toEqual(taskId?{taskId,protection:{closure:undefined}}:{taskId,unavailable:true});expect(await exit).toEqual([0]);}
    finally{await worker.terminate();}
  });
});

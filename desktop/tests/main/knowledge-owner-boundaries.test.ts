// @vitest-environment node
import {beforeAll,expect,it} from 'vitest';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
let facts:{controls:Array<{name:string;pass:boolean;reads?:number;sqlCalls?:number;error?:string}>};
beforeAll(async()=>{const require=createRequire(import.meta.url);const {stdout}=await promisify(execFile)(process.execPath,['--import',require.resolve('tsx'),fileURLToPath(new URL('../fixtures/knowledge-owned-child/owner-controls.mts',import.meta.url))],{timeout:15000});const line=stdout.split('\n').find(x=>x.startsWith('KNOWLEDGE_OWNER_FACTS:'));expect(line).toBeDefined();facts=JSON.parse(line!.slice('KNOWLEDGE_OWNER_FACTS:'.length));},18000);
it.each(Array.from({length:15},(_,i)=>i))('enforces real Knowledge owner control %i',i=>{expect(facts.controls[i]).toMatchObject({pass:true});});

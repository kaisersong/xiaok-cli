import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,existsSync,appendFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
vi.unmock('../../src/utils/system-credentials.js');
import {readProtectedJsonVersioned,saveProtectedJson} from '../../src/utils/protected-json-async.js';
// Source Vitest has no JS worker beside the TS file. Run this case on emitted
// .test-dist via the normal sandbox runner after compiling tests.
it.skipIf(!existsSync(new URL('../../src/utils/credential-worker.js',import.meta.url)))('uses the real main-to-worker production path for private file reads and writes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-file-worker-')),file=join(root,'config.json'),old=process.env.XIAOK_CONFIG_DIR,prior=Object.getOwnPropertyDescriptor(process,'type');process.env.XIAOK_CONFIG_DIR=root;Object.defineProperty(process,'type',{value:'browser',configurable:true});
 try{const saved=await saveProtectedJson(file,{schemaVersion:2,providers:{one:{apiKey:'worker-file-canary'}}},'missing');expect(saved.digest).toBeTruthy();expect(readFileSync(file,'utf8')).not.toContain('worker-file-canary');const disk=JSON.parse(readFileSync(join(root,'credentials','store.json'),'utf8'));expect(disk.backend).toBe('file');expect(Object.keys(disk.entries)).toHaveLength(1);appendFileSync(file,'\n');const parsed=await readProtectedJsonVersioned(file);expect(parsed.digest).not.toBe(saved.digest);expect(parsed.value).toEqual({schemaVersion:2,providers:{one:{apiKey:'worker-file-canary'}}});}
 finally{if(prior)Object.defineProperty(process,'type',prior);else delete(process as NodeJS.Process&{type?:string}).type;if(old===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=old;rmSync(root,{recursive:true,force:true});}
},process.platform==='win32'?60_000:12_000);

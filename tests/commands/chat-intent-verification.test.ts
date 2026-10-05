import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseIntentVerificationCommand,readIntentVerificationSelectionFile} from '../../src/commands/chat-intent-verification.js';
const roots:string[]=[];afterEach(()=>{for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
it('parses explicit user actions and preserves quoted material configuration paths',()=>{
 expect(parseIntentVerificationCommand('/intent verify reserve "my material.json"')).toEqual({kind:'reserve',path:'my material.json'});
 for(const kind of ['enroll','run','recover'])expect(parseIntentVerificationCommand(`/intent verify ${kind} original-id`)).toEqual({kind,id:'original-id'});
 for(const kind of ['status','cancel','help'])expect(parseIntentVerificationCommand(`/intent verify ${kind}`)).toEqual({kind});
 expect(()=>parseIntentVerificationCommand('/intent verify run')).toThrow();expect(()=>parseIntentVerificationCommand('/intent verify run "a\u0000b"')).toThrow();expect(parseIntentVerificationCommand('/intent native status')).toBeNull();
});
it('captures the complete explicit file without adding invocation identities or accepting unsafe file forms',()=>{
 const root=mkdtempSync(join(tmpdir(),'intent-verify-cli-'));roots.push(root);const path=join(root,'materials.json');
 const data={candidateId:'candidate',obligationId:'original',exactCommand:{argv:['node','independent.mjs'],cwdRelative:'.'},materials:[{path:join(root,'independent.mjs'),byteLimit:1024}],expiresAt:Date.now()+60000};writeFileSync(path,JSON.stringify(data));const read=readIntentVerificationSelectionFile(path);expect(read).toEqual(data);expect(Object.isFrozen(read)).toBe(true);expect(Object.isFrozen(read.materials)).toBe(true);
 writeFileSync(path,JSON.stringify({...data,invocation:{sessionIdentity:'forged'}}));expect(()=>readIntentVerificationSelectionFile(path)).toThrow();writeFileSync(path,JSON.stringify(data));symlinkSync(path,join(root,'alias'));expect(()=>readIntentVerificationSelectionFile(join(root,'alias'))).toThrow();expect(()=>readIntentVerificationSelectionFile(root)).toThrow();writeFileSync(path,Buffer.alloc(65537,32));expect(()=>readIntentVerificationSelectionFile(path)).toThrow();writeFileSync(path,Buffer.from([0xff]));expect(()=>readIntentVerificationSelectionFile(path)).toThrow();
});

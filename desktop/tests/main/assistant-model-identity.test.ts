import {it,expect} from 'vitest';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {readAssistantModelIdentity} from '../../../src/runtime/assistant/model-identity.js';
it('reads the actual fixed configuration on each use and exposes only a fingerprint and epoch',()=>{
 const dir=mkdtempSync(join(tmpdir(),'assistant-model-identity-')),old=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=dir;
 try{const file=join(dir,'config.json');writeFileSync(file,JSON.stringify({schemaVersion:2,defaultModelId:'one',defaultProvider:'deepseek',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',apiKey:'never-export-this-secret'}},models:{one:{provider:'deepseek',model:'deepseek-flash',label:'one'}}}));
 const first=readAssistantModelIdentity();expect(Object.keys(first).sort()).toEqual(['configFingerprint','modelEpoch']);expect(JSON.stringify(first)).not.toContain('never-export');
 const config=JSON.parse(requireRead(file));config.providers.deepseek.apiKey='another-secret';writeFileSync(file,JSON.stringify(config));expect(readAssistantModelIdentity().configFingerprint).not.toBe(first.configFingerprint);
 writeFileSync(file,'invalid');expect(()=>readAssistantModelIdentity()).toThrow();
 }finally{if(old===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=old;rmSync(dir,{recursive:true,force:true});}
});
import {readFileSync} from 'node:fs';function requireRead(file:string){return readFileSync(file,'utf8');}

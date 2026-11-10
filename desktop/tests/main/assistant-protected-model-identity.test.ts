// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ProtectedJsonFile} from '../../../src/utils/protected-json.js';
import * as credentials from '../../../src/utils/system-credentials.js';
import {readAssistantModelConfiguration} from '../../../src/runtime/assistant/model-identity.js';
it('reads public identity without vault IO and lazily resolves only the selected protected provider without changing the file',()=>{
 const root=mkdtempSync(join(tmpdir(),'assistant-protected-identity-')),file=join(root,'config.json'),rows=new Map<string,string>(),gets:string[]=[];
 const backend={get:(id:string)=>{gets.push(id);return rows.get(id)??null;},put:(id:string,value:string)=>{rows.set(id,value);}};
 const selectedKey='fixture-selected-only',otherKey='fixture-unselected-never-read',header='fixture-selected-header';
 new ProtectedJsonFile(file,backend).save({schemaVersion:2,defaultModelId:'selected',providers:{deepseek:{type:'first_party',protocol:'openai_legacy',baseUrl:'https://api.deepseek.com',apiKey:selectedKey,headers:{Authorization:header}},other:{type:'custom',protocol:'openai_legacy',baseUrl:'https://example.invalid',apiKey:otherKey}},models:{selected:{provider:'deepseek',model:'deepseek-flash'}}});
 const bytes=readFileSync(file),before=statSync(file),spy=vi.spyOn(credentials,'systemCredentialBackend').mockReturnValue(backend);gets.length=0;
 vi.stubEnv('XIAOK_CONFIG_DIR',root);vi.stubEnv('XIAOK_DEEPSEEK_API_KEY','');vi.stubEnv('DEEPSEEK_API_KEY','');
 try{const snapshot=readAssistantModelConfiguration();expect(snapshot.config.providers.deepseek.apiKey).toBeUndefined();expect(gets).toEqual([]);const owned=snapshot.transportForModel('selected');expect(gets).toEqual([]);expect(owned.resolve()).toEqual({apiKey:selectedKey,headers:expect.objectContaining({Authorization:header})});expect(gets).toHaveLength(2);expect(owned.knownSecrets()).toEqual(expect.arrayContaining([selectedKey,header]));expect(owned.knownSecrets()).not.toContain(otherKey);expect(readFileSync(file)).toEqual(bytes);expect(statSync(file).mtimeMs).toBe(before.mtimeMs);expect(JSON.stringify(snapshot.identity)).not.toContain('fixture-');}
 finally{spy.mockRestore();vi.unstubAllEnvs();rmSync(root,{recursive:true});}
});

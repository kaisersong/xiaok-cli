import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
import {spawn} from 'node:child_process';
import {installedControllerFixture} from '../../support/installed-controller-fixture.js';
import * as capacity from '../../../src/runtime/verification/installed-shared-capacity.js';
import {readInstalledCapacityAuthority,assertInstalledAssemblyDatabase} from '../../../src/runtime/verification/installed-controller.js';
it('only the original installed start issues the narrow token and never reissues its shared layer',async()=>{
 const spy=vi.spyOn(capacity,'createInstalledSharedCapacity');const f=await installedControllerFixture();const token=spy.mock.calls.at(-1)![0];
 try{const facts=readInstalledCapacityAuthority(token);expect(facts.database).toBe(f.database);expect(Object.keys(facts).sort()).toEqual(['authorityId','database']);expect(()=>assertInstalledAssemblyDatabase(token,f.database)).toThrow('installed_assembly_identity');expect(()=>readInstalledCapacityAuthority({...token})).toThrow('capacity_authority_configuration');expect(()=>capacity.createInstalledSharedCapacity(token)).toThrow('capacity_authority_layer_used');let traps=0;const proxy=new Proxy(token,{get(){traps++;throw Error('trap');},ownKeys(){traps++;throw Error('trap');}});expect(()=>capacity.createInstalledSharedCapacity(proxy)).toThrow('capacity_authority_configuration');expect(()=>capacity.createInstalledSharedCapacity({lifetime:f.database})).toThrow('capacity_authority_configuration');expect(traps).toBe(0);}
 finally{spy.mockRestore();await f.close();}expect(()=>readInstalledCapacityAuthority(token)).toThrow('capacity_authority_closed');
});
it('cold imports the actual controller and each capacity entry without initialization queries or an ESM cycle failure',async()=>{
 const modules=['installed-controller','installed-shared-capacity','shared-capacity-ledger','shared-blob-capacity','authority-blob-budget','blob-budget'];const urls=modules.map(name=>new URL('../../../src/runtime/verification/'+name+'.ts',import.meta.url).href);
 const source="import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const key=require.resolve('better-sqlite3');const Original=require(key);require.cache[key].exports=new Proxy(Original,{construct(){throw Error('unexpected database open during import');}});for(const url of "+JSON.stringify(urls)+")await import(url);process.stdout.write('cold import complete');";const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source],{stdio:['ignore','pipe','pipe']});let stderr='',stdout='';child.stderr.on('data',data=>stderr+=data);child.stdout.on('data',data=>stdout+=data);const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});expect(code,stderr).toBe(0);expect(stdout).toBe('cold import complete');
},15000);

import {expect,it,vi} from 'vitest';
import os,{userInfo,type UserInfo} from 'node:os';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
it('isolates named, default and buffer OS account home without changing actual identity',async()=>{
 const current=userInfo(),original=JSON.parse(execFileSync(process.execPath,['-e','process.stdout.write(JSON.stringify(require("node:os").userInfo()))'],{encoding:'utf8',timeout:5000})) as UserInfo<string>;expect(current.homedir).not.toBe(original.homedir);expect(existsSync(current.homedir)).toBe(true);expect(realpathSync(current.homedir)).toBe(current.homedir);expect(os.userInfo().homedir).toBe(current.homedir);expect(userInfo({encoding:'buffer'}).homedir.toString()).toBe(current.homedir);for(const field of ['uid','gid','username','shell'] as const)expect(current[field]).toEqual(original[field]);
});
it('persists an actual source registry only inside the isolated account',async()=>{
 const{registerOrdinaryProfileSource,readOrdinaryProfileSources}=await import('../../../src/runtime/verification/ordinary-profile-source-registry.js'),home=userInfo().homedir,source=join(home,'session-fixture');mkdirSync(source);registerOrdinaryProfileSource({kind:'session-root',directory:source});expect(readOrdinaryProfileSources()?.sources.some(row=>row.kind==='session-root'&&row.directory.canonicalPath===source)).toBe(true);expect(existsSync(join(home,'.xiaok','profile-sources','registry.json'))).toBe(true);
});

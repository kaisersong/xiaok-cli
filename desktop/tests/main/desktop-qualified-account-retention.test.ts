// @vitest-environment node
import {expect,it} from 'vitest';
import {existsSync,lstatSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import setupProfileAccount from '../../../tests/support/profile-account.global.mjs';

it('the actual global account teardown retains a malformed owned lease for parent inspection',async()=>{
 const provided=new Map<string,unknown>();
 const teardown=setupProfileAccount({provide:(key:string,value:unknown)=>provided.set(key,value)});
 const root=provided.get('profileTestAccountRoot');
 expect(typeof root).toBe('string');
 const canonical=realpathSync(root as string),created=lstatSync(canonical);
 let body:{error:unknown}|undefined;
 const cleanup:unknown[]=[];
 try{
  const leases=join(canonical,'.owner-leases');mkdirSync(leases,{recursive:true,mode:0o700});
  writeFileSync(join(leases,'incomplete-owned-lease.json'),'{',{flag:'wx',mode:0o600});
  let rejection:{error:unknown}|undefined;
  try{await teardown();}catch(error){rejection={error};}
  expect(existsSync(canonical)).toBe(true);
  expect(rejection).toBeDefined();
 }catch(error){body={error};}finally{
  // This unit creates only an account directory and a deliberately broken file;
  // it never constructs a runtime, service, native DB, Worker or child process.
  try{
   if(existsSync(canonical)){
    const current=lstatSync(canonical);
    expect(current.isDirectory()&&!current.isSymbolicLink()).toBe(true);
    expect(realpathSync(canonical)).toBe(canonical);
    for(const key of ['uid','dev','ino','birthtimeMs'] as const)expect(current[key]).toBe(created[key]);
    rmSync(canonical,{recursive:true,force:false});
   }
  }catch(error){cleanup.push(error);}
 }
 const errors=[...(body?[body.error]:[]),...cleanup];
 if(errors.length===1)throw errors[0];
 if(errors.length)throw new AggregateError(errors,'qualified_account_retention_and_unit_cleanup_failed',{cause:errors[0]});
});

// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
vi.unmock('../../../src/runtime/verification/ordinary-source-writer-observation.js');
import {setOrdinaryRouteAclProbeListener} from '../../../src/runtime/verification/migration-markers.js';
import {setOrdinaryRouteJobScopeReuse} from '../../../src/runtime/verification/windows-installation-absence.js';
import {ContinuityStore} from '../../electron/context-continuity/store.js';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';

afterEach(()=>{setOrdinaryRouteAclProbeListener();setOrdinaryRouteJobScopeReuse(true);});
it.skipIf(process.platform!=='darwin')('uses one real ACL route observation per original synchronous transaction, including nesting and rollback',()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-route-')),store=new ContinuityStore(join(root,'actual.sqlite'),'profile');let probes=0;
 try{
  setOrdinaryRouteAclProbeListener(()=>{probes++;});
  const write=()=>{for(let i=0;i<12;i++)store.db.prepare('INSERT OR REPLACE INTO continuity_meta VALUES (?,?)').run('route-fixture-'+i,String(i));};
  store.transaction(()=>{write();store.transaction(write);});expect(probes).toBe(1);
  probes=0;expect(()=>store.transaction(()=>{write();throw Error('rollback-fixture');})).toThrow('rollback-fixture');expect(probes).toBe(1);
  probes=0;store.transaction(write);expect(probes).toBe(1);
  probes=0;store.db.prepare('SELECT 1').get();store.db.prepare('SELECT 1').get();expect(probes).toBe(4);
  setOrdinaryRouteJobScopeReuse(false);probes=0;store.transaction(write);expect(probes).toBeGreaterThan(20);
 }finally{setOrdinaryRouteAclProbeListener();store.close();rmSync(root,{recursive:true,force:true});}
});
it.skipIf(process.platform!=='darwin')('keeps a newly published writer denial fresh inside the same real route scope',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'continuity-route-fence-'))),store=new ContinuityStore(join(root,'actual.sqlite'),'profile');
 // profile-account.setup owns this private OS-account view; never the user's home.
 const home=userInfo().homedir;if(!home.includes('xiaok-vitest-accounts-'))throw Error('private_fixture_account_required');
 const fences=join(home,'.xiaok','profile-sources','writer-fences');mkdirSync(fences,{recursive:true,mode:0o700});
 const name=createHash('sha256').update(canonicalVerificationJson([process.getuid!(),root])).digest('hex'),target=join(fences,name+'.json');
 try{expect(()=>store.transaction(()=>{store.db.prepare('SELECT 1').get();writeFileSync(target,'{}',{mode:0o600,flag:'wx'});store.db.prepare('SELECT 1').get();})).toThrow('known_writer_fence_fenced');}
 finally{rmSync(target,{force:true});store.close();rmSync(root,{recursive:true,force:true});}
});
it.skipIf(process.platform!=='darwin')('closes the route scope before an async transaction continuation can issue another statement',async()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-route-async-')),store=new ContinuityStore(join(root,'actual.sqlite'),'profile');let probes=0,done!:()=>void;
 const gate=new Promise<void>(resolve=>{done=resolve;});let continuation:Promise<void>|undefined;
 try{setOrdinaryRouteAclProbeListener(()=>{probes++;});expect(()=>store.transaction(()=>{continuation=(async()=>{await gate;store.db.prepare('SELECT 1').get();})();return continuation;})).toThrow('async_transaction_not_supported');expect(probes).toBe(1);probes=0;done();await continuation;expect(probes).toBe(2);}
 finally{setOrdinaryRouteAclProbeListener();store.close();rmSync(root,{recursive:true,force:true});}
});
it.skipIf(process.platform!=='darwin')('measures the original SQLite transaction against the existing no-reuse reverse control',()=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-route-timing-')),store=new ContinuityStore(join(root,'actual.sqlite'),'profile');const observations:Array<{reuse:boolean;elapsedMs:number;probes:number}>=[];
 try{for(const reuse of [false,true]){setOrdinaryRouteJobScopeReuse(reuse);let probes=0;setOrdinaryRouteAclProbeListener(()=>{probes++;});const start=performance.now();store.transaction(()=>{for(let i=0;i<200;i++)store.db.prepare('INSERT OR REPLACE INTO continuity_meta VALUES (?,?)').run('timing-'+i,String(i));});observations.push({reuse,elapsedMs:performance.now()-start,probes});}console.log(JSON.stringify({kind:'real-acl-sqlite-route-reverse-control',observations}));expect(observations[0].probes).toBe(402);expect(observations[1].probes).toBe(1);}
 finally{setOrdinaryRouteAclProbeListener();setOrdinaryRouteJobScopeReuse(true);store.close();rmSync(root,{recursive:true,force:true});}
});

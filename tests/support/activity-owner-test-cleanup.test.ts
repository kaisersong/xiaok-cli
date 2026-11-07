import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createActivityOwnerTestScope} from './activity-owner-test-cleanup.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true,maxRetries:3});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'activity-scope-test-'));roots.push(root);const dataRoot=join(root,'config','conversation-activity');mkdirSync(dataRoot,{recursive:true});return {root,dataRoot,scope:createActivityOwnerTestScope(()=>[root])};}
it('seals an entered late attachment before its original constructor and joins its actual pending call',async()=>{
 const f=fixture();let release!:()=>void;const gate=new Promise<void>(yes=>{release=yes;});
 const pending=f.scope.runOriginalLaunch(f.dataRoot,async spawn=>{await gate;return spawn(process.execPath,['owner-entry.js',join(f.dataRoot,'activity-owner.config.json')],{});});
 const rejected=pending.catch(raw=>raw),closing=f.scope.close();expect(f.scope.close()).toBe(closing);release();expect((await rejected).message).toBe('fixture_activity_owner_scope_closed');await closing;expect(()=>f.scope.assertClosed()).not.toThrow();
});
it('does not stop an attached client or infer a birth from its caller-supplied PID',async()=>{
 const f=fixture(),foreign={pid:process.pid,kill(){throw Error('must not kill an attachment');}};
 expect(await f.scope.runOriginalLaunch(f.dataRoot,async()=>foreign)).toBe(foreign);await f.scope.close();expect(()=>f.scope.assertClosed()).not.toThrow();
});
it('rejects a nonowned root before invoking its original launch operation',async()=>{
 const f=fixture(),other=mkdtempSync(join(tmpdir(),'activity-other-'));roots.push(other);let invoked=0;
 expect(()=>f.scope.runOriginalLaunch(other,async()=>{invoked++;return undefined;})).toThrow('fixture_activity_owner_outside_owned_root');expect(invoked).toBe(0);await f.scope.close();
});

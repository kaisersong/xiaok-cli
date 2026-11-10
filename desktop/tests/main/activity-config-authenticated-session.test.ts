import {afterEach,expect,it} from 'vitest';
import {ownedConfigDaemonFixture} from '../support/owned-config-daemon-fixture.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const fixture=()=>ownedConfigDaemonFixture(close=>cleanups.push(close));
it('actual canonical daemon binds its original KS target, warms up without business, then invokes fixed fresh prepare',async()=>{
 const f=await fixture();expect(f.floor()).toBe(0);const installed=await f.install();expect(installed.type).toBe('installed');const session=f.session(installed);f.send({...session,type:'offer',offerId:1,op:'prepare_initial_plan_writer'});const challenge=await f.get('command_challenge',1);expect(challenge.targetGeneration).toBeGreaterThan(0);expect(challenge.childBoot).toMatch(/^[a-f0-9]{64}$/);expect(f.floor()).toBe(0);f.send({...challenge,type:'invoke'});const result=await f.get('command_result',1);expect(result.result).toMatchObject({ok:true,profile:{schemaVersion:2}});expect(f.floor()).toBe(1);
},20000);
it('one session may inspect through the fixed target and cannot select migration',async()=>{
 const f=await fixture(),installed=await f.install();expect(installed.type).toBe('installed');const session=f.session(installed);f.send({...session,type:'offer',offerId:1,op:'inspect_writer'});const challenge=await f.get('command_challenge',1);f.send({...challenge,type:'invoke'});expect((await f.get('command_result',1)).result).toMatchObject({ok:true});expect(f.floor()).toBe(0);f.send({...session,type:'offer',offerId:2,op:'migrate_default_dispatch_writer'});await f.get('fault');expect(f.floor()).toBe(0);
},20000);

import {existsSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const preload=resolve('tests/e2e/fixtures/authenticated-config-sdk-preload.cjs');
async function heldFixture(type:string,mode='callback'){return ownedConfigDaemonFixture(close=>cleanups.push(close),{daemonPreload:preload,daemonEnv:{CONFIG_HOLD_TYPES:type,CONFIG_SDK_MODE:mode}});}
async function held(f:Awaited<ReturnType<typeof fixture>>,type:string,id=0){await f.wait(()=>existsSync(join(f.root,`held-${type}-${id}.json`))?true:undefined);}
function release(f:Awaited<ReturnType<typeof fixture>>,type:string,id=0){writeFileSync(join(f.root,`release-${type}-${id}`),'1');}
function count(f:Awaited<ReturnType<typeof fixture>>,type:string,id?:number){return f.frames.filter(row=>row.type===type&&(id===undefined||row.offerId===id)).length;}
async function offerChallenge(f:Awaited<ReturnType<typeof fixture>>,installed:Record<string,unknown>,id=1,op='prepare_initial_plan_writer'){f.send({...f.session(installed),type:'offer',offerId:id,op});return f.get('command_challenge',id);}
it('greeting receipt does not release a queued install before the original callback',async()=>{
 const f=await heldFixture('daemon_hello');await held(f,'daemon_hello');f.send({...f.base,type:'install'});await delay(80);expect(count(f,'installed')).toBe(0);expect(f.floor()).toBe(0);release(f,'daemon_hello');await f.get('installed');
},20000);
it('installed receipt reserves one offer but cannot warm or challenge before its original callback',async()=>{
 const f=await heldFixture('installed'),installed=await f.install();await held(f,'installed');f.send({...f.session(installed),type:'offer',offerId:1,op:'prepare_initial_plan_writer'});await delay(80);expect(count(f,'command_challenge')).toBe(0);expect(f.floor()).toBe(0);release(f,'installed');const c=await f.get('command_challenge',1);f.send({...c,type:'invoke'});await f.get('command_result',1);expect(f.floor()).toBe(1);
},20000);
it('challenge receipt reserves invoke while its original SDK callback still prevents Native prepare',async()=>{
 const f=await heldFixture('command_challenge'),installed=await f.install(),c=await offerChallenge(f,installed);await held(f,'command_challenge',1);f.send({...c,type:'invoke'});await delay(80);expect(count(f,'command_result')).toBe(0);expect(f.floor()).toBe(0);release(f,'command_challenge',1);await f.get('command_result',1);expect(f.floor()).toBe(1);
},20000);
it('result receipt cannot release the next offer before the original result SDK tail',async()=>{
 const f=await heldFixture('command_result'),installed=await f.install(),c=await offerChallenge(f,installed);f.send({...c,type:'invoke'});await f.get('command_result',1);await held(f,'command_result',1);f.send({...f.session(installed),type:'offer',offerId:2,op:'inspect_writer'});await delay(80);expect(count(f,'command_challenge',2)).toBe(0);expect(f.floor()).toBe(1);release(f,'command_result',1);const c2=await f.get('command_challenge',2);f.send({...c2,type:'invoke'});await f.get('command_result',2);expect(f.floor()).toBe(1);release(f,'command_result',2);
},20000);
it.each(['installed','command_challenge'])('%s callback failure rejects its already reserved successor without a late mutation',async type=>{
 const f=await heldFixture(type,'error'),installed=await f.install();if(type==='installed'){await held(f,type);f.send({...f.session(installed),type:'offer',offerId:1,op:'prepare_initial_plan_writer'});release(f,type);}else{const c=await offerChallenge(f,installed);await held(f,type,1);f.send({...c,type:'invoke'});release(f,type,1);}await f.wait(()=>existsSync(join(f.root,`released-${type}-${type==='installed'?0:1}.json`))?true:undefined);await delay(100);expect(f.floor()).toBe(0);expect(count(f,'command_result')).toBe(0);if(type==='installed')expect(count(f,'command_challenge')).toBe(0);expect((await f.client.request<{ready:boolean}>('status')).ready).toBe(true);
},20000);
it('normal prefix waits an already admitted invoke behind its challenge callback, then reports the actual KS prefix',async()=>{
 const f=await heldFixture('command_challenge'),installed=await f.install(),c=await offerChallenge(f,installed);await held(f,'command_challenge',1);f.send({...c,type:'invoke'});f.send({...f.session(installed),type:'seal_prefix',throughInvokeId:1,sealNonce:'d'.repeat(64)});await delay(80);expect(f.floor()).toBe(0);expect(count(f,'prefix_drained')).toBe(0);release(f,'command_challenge',1);await f.get('command_result',1);const marker=await f.get('prefix_drained');expect(marker.throughInvokeId).toBe(1);expect(f.floor()).toBe(1);f.send({...f.session(installed),type:'offer',offerId:2,op:'prepare_initial_plan_writer'});await delay(80);expect(count(f,'command_challenge',2)).toBe(0);
},20000);
it('normal prefix cancels an offer queued behind installed, preserving its matching negative ACK',async()=>{
 const f=await heldFixture('installed'),installed=await f.install();await held(f,'installed');f.send({...f.session(installed),type:'offer',offerId:1,op:'prepare_initial_plan_writer'});f.send({...f.session(installed),type:'seal_prefix',throughInvokeId:0,sealNonce:'d'.repeat(64)});await delay(80);expect(count(f,'prefix_drained')).toBe(0);release(f,'installed');expect(await f.get('offer_cancelled',1)).toMatchObject({reason:'configuration_closing',op:'prepare_initial_plan_writer'});await f.get('prefix_drained');expect(count(f,'command_challenge')).toBe(0);expect(f.floor()).toBe(0);
},20000);
it('endpoint lifecycle still owns a prefix terminal notification after business prefix is qualified',async()=>{
 const f=await heldFixture('prefix_drained'),installed=await f.install();f.send({...f.session(installed),type:'seal_prefix',throughInvokeId:0,sealNonce:'d'.repeat(64)});await f.get('prefix_drained');await held(f,'prefix_drained');f.child.kill('SIGTERM');await delay(120);expect(f.child.exitCode).toBeNull();expect(f.child.signalCode).toBeNull();release(f,'prefix_drained');await f.closed;expect(f.child.exitCode).toBe(0);
},20000);
it.each(['daemonBoot','configConnectionIncarnation','scope','op','extra','offerId','commandNonce','targetGeneration','childBoot'])('closed session rejects altered %s without Native business',async field=>{
 const f=await fixture(),installed=await f.install(),c=await offerChallenge(f,installed),row:Record<string,unknown>={...c,type:'invoke'};
 if(field==='scope')row.scope={...f.scope,workspaceId:'e'.repeat(64)};else if(field==='op')row.op='migrate_default_dispatch_writer';else if(field==='extra')row.extra=true;else if(field==='offerId')row.offerId=2;else if(field==='targetGeneration')row.targetGeneration=Number(c.targetGeneration)+1;else row[field]='e'.repeat(64);
 f.send(row);await f.get('fault');await delay(50);expect(f.floor()).toBe(0);expect(count(f,'command_result')).toBe(0);
},20000);
it.each(['raw','thenable','throw'])('installed SDK %s never uses a received ACK to release queued business',async mode=>{
 const f=await heldFixture('installed',mode),installed=await f.install();await held(f,'installed');f.send({...f.session(installed),type:'offer',offerId:1,op:'prepare_initial_plan_writer'});release(f,'installed');await delay(80);expect(f.floor()).toBe(0);expect(count(f,'command_challenge')).toBe(0);expect(existsSync(join(f.root,'forbidden-sdk-then.json'))).toBe(false);
 if(mode==='raw'){f.child.kill('SIGTERM');await delay(100);expect(f.child.exitCode).toBeNull();writeFileSync(join(f.root,'release-raw-installed-0'),'1');await f.closed;expect(f.child.exitCode).toBe(1);}
},20000);
it('stale source restart cannot revoke the original audience and a later legitimate invoke still succeeds',async()=>{
 const f=await fixture(),installed=await f.install(),c=await offerChallenge(f,installed);await expect(f.client.request('sourceRestart',{name:'kswarm',ownerEpoch:'stale'})).rejects.toThrow();f.send({...c,type:'invoke'});await f.get('command_result',1);expect(f.floor()).toBe(1);
},20000);
it('legitimate KS restart synchronously seals the old audience behind a held challenge and prevents late prepare',async()=>{
 const f=await heldFixture('command_challenge'),installed=await f.install(),c=await offerChallenge(f,installed);await held(f,'command_challenge',1);
 f.send({...c,type:'invoke'});const restart=f.client.request('sourceRestart',{name:'kswarm',ownerEpoch:f.hello.ownerEpoch});await restart;f.send({...c,type:'invoke'});release(f,'command_challenge',1);await delay(100);expect(f.floor()).toBe(0);expect(count(f,'command_result')).toBe(0);
},20000);
it('install cannot choose a different target scope or retry into a future installation',async()=>{
 const f=await fixture();f.send({...f.base,type:'install',scope:{...f.scope,workspaceId:'e'.repeat(64)}});expect(await f.get('install_unavailable')).toMatchObject({reason:'target_not_owned'});f.send({...f.base,type:'install'});await delay(80);expect(count(f,'installed')).toBe(0);expect(count(f,'command_challenge')).toBe(0);expect(f.floor()).toBe(0);
},20000);
it('duplicate invoke never executes prepare twice',async()=>{
 const f=await fixture(),installed=await f.install(),c=await offerChallenge(f,installed);f.send({...c,type:'invoke'});await f.get('command_result',1);f.send({...c,type:'invoke'});await f.get('fault');expect(count(f,'command_result')).toBe(1);expect(f.floor()).toBe(1);
},20000);
it('an unqualified challenge cannot be replaced by a prefix marker',async()=>{
 const f=await heldFixture('command_challenge'),installed=await f.install();await offerChallenge(f,installed);await held(f,'command_challenge',1);f.send({...f.session(installed),type:'seal_prefix',throughInvokeId:0,sealNonce:'d'.repeat(64)});await delay(80);expect(count(f,'prefix_drained')).toBe(0);release(f,'command_challenge',1);await f.get('prefix_drained');expect(count(f,'offer_cancelled')).toBe(0);expect(f.floor()).toBe(0);
},20000);
import {DatabaseSync} from 'node:sqlite';
it('Native persistence failure still waits the original error-result SDK callback during endpoint close',async()=>{
 const f=await heldFixture('command_result'),installed=await f.install(),c=await offerChallenge(f,installed),db=new DatabaseSync(join(f.root,'ks','state.sqlite'));let locked=true;cleanups.push(async()=>{if(locked)db.exec('ROLLBACK');db.close();});db.exec('BEGIN IMMEDIATE');f.send({...c,type:'invoke'});const result=await f.get('command_result',1);expect(result.error).toBeTruthy();await held(f,'command_result',1);db.exec('ROLLBACK');locked=false;const sidecarFile=readdirSync(f.root).find(name=>/^sidecar-kswarm-[0-9]+\.json$/.test(name))!;const sidecar=JSON.parse(readFileSync(join(f.root,sidecarFile),'utf8'));await f.wait(()=>{try{process.kill(sidecar.pid,0);return undefined;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'?true:undefined;}});await delay(60);f.child.kill('SIGTERM');await delay(160);console.log(JSON.stringify({test:'Native-failure-original-error-SDK-tail',pid:f.child.pid,exitedEarly:f.child.exitCode!==null||f.child.signalCode!==null,code:f.child.exitCode,callbackReleased:existsSync(join(f.root,'released-command_result-1.json')),error:result.error}));expect(f.child.exitCode).toBeNull();expect(f.child.signalCode).toBeNull();release(f,'command_result',1);await f.closed;expect(f.child.exitCode).toBe(1);
},25000);

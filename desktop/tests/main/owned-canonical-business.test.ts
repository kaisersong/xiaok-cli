// Real canonical Node process; a controlled low-hop command is not NativeMain.
import {afterEach,expect,it} from 'vitest';
import {ownedConfigDaemonFixture} from '../support/owned-config-daemon-fixture.js';
import {setTimeout as delay} from 'node:timers/promises';
const load=()=>import('../../../src/runtime/conversation-activity/owned-canonical-business.js'),cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function original({hold=false}={}){
 const module=await load(),f=await ownedConfigDaemonFixture(close=>cleanups.push(close)),proof={},owner={},sent:any[]=[];let release:(()=>void)|undefined;
 const send=f.child.send!.bind(f.child);Object.defineProperty(f.child,'send',{configurable:true,value:(frame:any,callback:any)=>{sent.push(frame);return send(frame,error=>{if(hold&&frame.type==='request')release=()=>callback(error);else callback?.(error);});}});
 const client=module.createOwnedCanonicalBusiness({child:f.child,scope:f.scope,serviceOwner:owner,mainLaunchNonce:'e'.repeat(64),ownerEpoch:String(f.hello.ownerEpoch),isCurrent:()=>f.child.connected===true,admit(candidate,audience){if(candidate!==proof||audience.serviceOwner!==owner||audience.projectId!=='p')throw Error('controlled_command_denied');}});
 cleanups.push(async()=>{release?.();await client.sealAndDrainPrefix().catch(()=>{});});
 return{...f,client,sent,context:{requestSource:'user' as const,admission:proof,signal:new AbortController().signal},release:()=>release?.(),get held(){return !!release;}};
}
it('uses the actual canonical session with all target fields and keeps configuration independent',async()=>{
 const f=await original();expect(await f.client.readPlan('p',f.context)).toMatchObject({ok:false});expect(f.floor()).toBe(0);
 const installed=await f.install();expect(installed.type).toBe('installed');await f.client.sealAndDrainPrefix();const probe=f.sent.find(frame=>frame.type==='probe'),request=f.sent.find(frame=>frame.type==='request');expect(probe.mainLaunchNonce).toBe('e'.repeat(64));expect(request.targetGeneration).toBe(1);expect(request.ownerEpoch).toBe(f.hello.ownerEpoch);expect(request.connectionIncarnation).toMatch(/^[a-f0-9]{64}$/);expect(request.childBoot).toMatch(/^[a-f0-9]{64}$/);
},15000);
it('refuses agent and copied command data before producer SDK work',async()=>{
 const f=await original();await expect(f.client.readPlan('p',{...f.context,requestSource:'agent'})).rejects.toThrow();await expect(f.client.readPlan('p',{...f.context,admission:{}})).rejects.toThrow();expect(f.sent).toHaveLength(0);
},15000);
it('keeps an actual canonical reply separate from the original held parent callback',async()=>{
 const f=await original({hold:true});let returned=false,drained=false;const call=f.client.readPlan('p',f.context).then(()=>{returned=true;},()=>{returned=true;});
 for(let n=0;n<1000&&!f.held;n++)await delay(5);expect(f.held).toBe(true);await f.wait(()=>f.frames.find(frame=>frame.protocol==='activity_dispatch_business_v1'&&frame.type==='response'));
 const drain=f.client.sealAndDrainPrefix().then(()=>{drained=true;},()=>{drained=true;});try{await delay(30);expect(returned).toBe(false);expect(drained).toBe(false);}finally{f.release();await call;await drain;}
},15000);

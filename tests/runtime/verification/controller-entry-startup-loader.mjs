// Fixed test-only startup boundary; actual entry and SQLite lifetime lock run in
// the child. Unreferenced IPC is deliberately not the startup liveness owner.
import {registerHooks} from 'node:module';
const mode=process.env.SOLPI_ENTRY_TEST_MODE,root=process.env.SOLPI_ENTRY_TEST_ROOT;
if(!['pending-success','pending-rejected','pending-unresolved'].includes(mode)||!root)throw Error('test startup mode');
const lockModule=new URL('../../../src/runtime/verification/controller-lifetime-lock.ts',import.meta.url).href;
registerHooks({load(url,context,next){
 if(!/\/runtime\/verification\/installed-controller\.(?:ts|js)$/.test(new URL(url).pathname))return next(url,context);
 return {format:'module',shortCircuit:true,source:`
 import {acquireControllerLifetimeLock} from ${JSON.stringify(lockModule)};
 const failure=new AggregateError([Error('original startup'),Error('unknown cleanup')],'installed_controller_startup_cleanup_unknown');
 export function isInstalledControllerShutdownUnresolved(error){return error===failure;}
 export async function startInstalledVerificationController(){
  const lock=acquireControllerLifetimeLock(${JSON.stringify(root)});
  const released=new Promise(resolve=>{process.on('message',function release(message){if(message==='release'){process.removeListener('message',release);resolve();}});});
  process.channel?.unref();process.send?.({event:'pending'});
  await released;
  const mode=${JSON.stringify(mode)};
  if(mode==='pending-unresolved')throw failure;
  if(mode==='pending-rejected'){lock.close();throw Error('known clean startup refusal');}
  const active=setInterval(()=>{},30000);process.send?.({event:'ready'});
  return {async close(){process.send?.({event:'close'});clearInterval(active);await new Promise(resolve=>setImmediate(resolve));lock.close();}};
 }
 `};
}});

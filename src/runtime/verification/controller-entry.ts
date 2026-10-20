import {startInstalledVerificationController,isInstalledControllerShutdownUnresolved} from './installed-controller.js';
let unresolvedHold:ReturnType<typeof setInterval>|undefined;
function retainUnresolvedLifetime(){
 if(unresolvedHold)return;
 // Deliberately referenced: pending/unknown drain must not restart under KeepAlive.
 unresolvedHold=setInterval(()=>{},30000);
 process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});
}
/** Fixed installed service entry. No CLI flags, environment-selected identity,
 * configuration path or fallback ordinary controller. */
async function main(){
 if(process.argv.length!==2)throw Error('controller_entry_arguments');
 // A Promise alone does not retain the real owner lock. Establish this hold
 // before the zero-argument root can enter any pending startup/recovery cleanup.
 const startupHold=setInterval(()=>{},30000);
 let controller:Awaited<ReturnType<typeof startInstalledVerificationController>>|undefined,shuttingDown=false,stopRequested=false;
 const failed=()=>{process.exitCode=1;process.stderr.write('verification_controller_shutdown_unresolved\n');};
 const stop=()=>{
  if(!controller){stopRequested=true;return;}
  if(shuttingDown)return;shuttingDown=true;retainUnresolvedLifetime();
  try{void controller.close().then(()=>{clearInterval(unresolvedHold);unresolvedHold=undefined;},failed);}catch{failed();}
 };
 // Pending startup cannot revert to the signal's default process termination.
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 try{controller=await startInstalledVerificationController();}
 catch(error){
  if(isInstalledControllerShutdownUnresolved(error))retainUnresolvedLifetime();
  else{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
  clearInterval(startupHold);throw error;
 }
 if(stopRequested)stop();
 clearInterval(startupHold);
}
void main().catch(error=>{if(isInstalledControllerShutdownUnresolved(error))retainUnresolvedLifetime();process.exitCode=1;process.stderr.write('verification_controller_start_rejected\n');});

// Test-only fixed module boundary: actual controller-entry.ts still runs in a real Node child.
import {registerHooks} from 'node:module';
const mode=process.env.SOLPI_ENTRY_TEST_MODE;
if(!['success','close-failure','close-pending','close-sync','startup-unresolved','startup-rejected'].includes(mode))throw Error('test mode');
registerHooks({load(url,context,next){if(!/\/runtime\/verification\/installed-controller\.(?:ts|js)$/.test(new URL(url).pathname))return next(url,context);
 return {format:'module',shortCircuit:true,source:`
 const failure=new Error('actual boundary shutdown unknown');
 export function isInstalledControllerShutdownUnresolved(error){return error===failure;}
 export async function startInstalledVerificationController(){
  const mode=${JSON.stringify(mode)};
  if(mode==='startup-unresolved')throw failure;
  if(mode==='startup-rejected')throw Error('ordinary startup rejection');
  const active=setInterval(()=>{},30000);process.send?.({event:'ready'});
  return {close(){process.send?.({event:'close'});clearInterval(active);if(mode==='close-sync')throw failure;return (async()=>{await new Promise(resolve=>setImmediate(resolve));if(mode==='close-failure')throw failure;if(mode==='close-pending')await new Promise(()=>{});})();}};
 }
 `};}});

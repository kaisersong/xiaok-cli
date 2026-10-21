import {provisionInstalledEgress} from './deployment-egress-configuration.js';
import {initializeInstalledCompositeState} from './deployment-composite-state.js';
import {readFileSync,lstatSync} from 'node:fs';
import {isAbsolute,dirname} from 'node:path';
import {parseDeploymentPackageInventory} from './deployment-package.js';
import {probeFrozenMacRuntime} from './macos-runtime-preflight.js';
import {initializeInstalledMacState} from './deployment-install-state.js';
/** Explicit packaging/installation commands. No daemon, fallback authority or
 * implicit privilege escalation is hidden behind preflight. */
export function runDeploymentCommand(argv:readonly string[]):void{
 const args=[...argv];
 if(args.length===2&&args[0]==='provision-egress'&&/^[a-f0-9]{64}$/.test(args[1])){provisionInstalledEgress(args[1]);return;}
 if(args.length===4&&args[0]==='initialize-composite-state'&&/^[a-f0-9]{64}$/.test(args[1])&&/^[1-9][0-9]{0,9}$/.test(args[2])&&/^[1-9][0-9]{0,9}$/.test(args[3])){initializeInstalledCompositeState(args[1],Number(args[2]),Number(args[3]));return;}
 if(args.length===4&&args[0]==='initialize-state'&&/^[a-f0-9]{64}$/.test(args[1])&&/^[1-9][0-9]{0,9}$/.test(args[2])&&/^[1-9][0-9]{0,9}$/.test(args[3])){
  initializeInstalledMacState(args[1],Number(args[2]),Number(args[3]));return;
 }
 if(args.length!==7||args[0]!=='deployment-preflight'||args[1]!=='--release-root'||args[3]!=='--target-root'||args[5]!=='--inventory'||![args[2],args[4],args[6]].every(isAbsolute))throw Error('deployment_command');
 const stat=lstatSync(args[6]);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>8*1024**2)throw Error('deployment_inventory');
 const inventory=parseDeploymentPackageInventory(JSON.parse(readFileSync(args[6],'utf8')));
 // Runtime bytes are tested at staging. Their final absolute target is checked
 // by installed identity again; a packaging probe is never OS qualification.
 if(args[2]===args[4])throw Error('deployment_command');
 probeFrozenMacRuntime({releaseRoot:args[2],stateRoot:dirname(args[2]),inventory});
}

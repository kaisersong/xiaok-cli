import {assertOriginalSupervisorImplementationContext} from './source-supervisor.js';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import type {configBirthContext} from './source-supervisor.js';
let configMinted=false,configMinting=false,configMintPoisoned=false;
export function mintCanonicalDesktopConfigBirth(context:configBirthContext):object|undefined {
 assertOriginalSupervisorImplementationContext(context,'birth');
 const {configPathSame,configPrototype,configAsyncPrototype,configFreeze,configCreate,configApply,configWeakSet,configBirths}=context;
 if(configMinting){configMintPoisoned=true;throw Error('activity_config_birth_reentry');}
 if(configMinted||configMintPoisoned||!process.argv[1]||!process.argv[2]||!configPathSame(process.argv[1],fileURLToPath(new URL('./owner-entry.js',import.meta.url))))return;
 configMinting=true;
 try{
  const channel=process.channel,send=process.send;if(!channel||process.connected!==true||typeof send!=='function'||types.isProxy(send)||types.isAsyncFunction(send)||configPrototype(send)===configAsyncPrototype)return;
  if(configMintPoisoned)throw Error('activity_config_birth_reentry');
  const birth=configFreeze(configCreate(null));configApply(configWeakSet,configBirths,[birth,{configFile:realpathSync.native(process.argv[2]),channel,send,used:false}]);configMinted=true;return birth;
 }finally{configMinting=false;}
}


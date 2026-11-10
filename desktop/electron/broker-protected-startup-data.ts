/** Fixed business data only. None of these DTOs establishes Native membership. */
import {mkdtempSync,lstatSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {types} from 'node:util';
import {getConfigDir} from '../../src/utils/config.js';
const descriptor=Object.getOwnPropertyDescriptor,keys=Reflect.ownKeys,own=Object.hasOwn,freeze=Object.freeze;
function denied():never{throw Error('BROKER_ORIGINAL_STARTUP_REQUIRED');}
export function createOriginalBrokerServiceEnvironment(desktopToken:string,kswarmToken:string):Readonly<Record<string,string>>{
 for(const token of [desktopToken,kswarmToken])if(typeof token!=='string'||!token.length||token.length>4096||token.includes('\0'))denied();if(desktopToken===kswarmToken)denied();
 const directory=mkdtempSync(join(realpathSync(getConfigDir()),'broker-main-')),fact=lstatSync(directory);
 if(realpathSync(directory)!==directory)denied();
 if(fact.isSymbolicLink()||!fact.isDirectory()||(fact.mode&0o777)!==0o700||typeof process.getuid!=='function'||fact.uid!==process.getuid())denied();
 return freeze({XIAOK_CONFIG_DIR:directory,PORT:'4318',INTENT_BROKER_DB:join(directory,'broker.sqlite'),INTENT_BROKER_SOCKET_PATH:'',INTENT_BROKER_DESKTOP_TOKEN:desktopToken,INTENT_BROKER_KSWARM_TOKEN:kswarmToken});
}
export function readOriginalBrokerReadyMessage(raw:unknown):Readonly<{port:number;pid:number}>|null{
 if(!raw||typeof raw!=='object'||types.isProxy(raw))denied();
 const names=keys(raw),kind=descriptor(raw,'kind');if(!kind||!own(kind,'value'))denied();
 if(kind.value==='original_broker_waiting_v1'){if(names.length!==1)denied();return null;}
 if(kind.value!=='original_broker_ready_v1'||names.length!==3)denied();
 for(let i=0;i<names.length;i++)if(names[i]!=='kind'&&names[i]!=='port'&&names[i]!=='pid')denied();
 const port=descriptor(raw,'port'),pid=descriptor(raw,'pid');if(!port||!pid||!own(port,'value')||!own(pid,'value')||!Number.isInteger(port.value)||port.value<1||port.value>65535||!Number.isSafeInteger(pid.value)||pid.value<1)denied();
 return freeze({port:port.value as number,pid:pid.value as number});
}

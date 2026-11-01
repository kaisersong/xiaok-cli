import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {getConfigPath} from '../../utils/config.js';
import {normalizeConfig} from '../../ai/providers/normalize.js';
import {resolveProviderTransport} from '../../ai/providers/auth-resolver.js';
import type {Config,ConfigInput} from '../../types.js';
/** Fixed user configuration only. No loadConfig repair/write behavior. Effective
 * secrets stay inside this reader: only one combined identity crosses the boundary. */
export function readAssistantModelConfiguration():{config:Config;identity:{modelEpoch:number;configFingerprint:string}}{
 try{
  const file=getConfigPath(),before=lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>1024*1024)throw Error();
  const bytes=readFileSync(file),after=lstatSync(file);
  if(bytes.length>1024*1024||after.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.size!==after.size)throw Error();
  const raw=JSON.parse(bytes.toString('utf8')) as ConfigInput;
  if(!raw||typeof raw!=='object'||!('schemaVersion' in raw)||![1,2].includes(raw.schemaVersion))throw Error();
  const config=normalizeConfig(raw);
  const transports=Object.keys(config.providers).sort().map(providerId=>{
   const transport=resolveProviderTransport(config,providerId);
   return {...transport,headers:Object.fromEntries(Object.entries(transport.headers).sort(([a],[b])=>a<b?-1:a>b?1:0))};
  });
  const configFingerprint=createHash('sha256').update('assistant-effective-model-identity-v2\0').update(bytes).update('\0').update(JSON.stringify(transports)).digest('hex');
  return {config,identity:{modelEpoch:Math.max(1,Math.floor(after.mtimeMs)),configFingerprint}};
 }catch{
  // JSON/provider/filesystem errors may include key-bearing input or a path.
  throw Error('assistant_model_configuration_unavailable');
 }
}
/** No secret-bearing transport or standalone key hash is exported. */
export function readAssistantModelIdentity(){return readAssistantModelConfiguration().identity;}

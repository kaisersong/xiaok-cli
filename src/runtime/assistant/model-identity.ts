import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {getConfigPath} from '../../utils/config.js';
import {ProtectedJsonFile} from '../../utils/protected-json.js';
import {normalizeConfig} from '../../ai/providers/normalize.js';
import {resolveProviderApiKey,resolveProviderTransport} from '../../ai/providers/auth-resolver.js';
import {resolveConfiguredModelBinding} from '../../ai/providers/model-binding.js';
import {resolveRuntimeModelBinding} from '../../ai/providers/control-plane.js';
import type {AdapterCredentialResolver} from '../../ai/providers/model-harness-profile.js';
import type {Config,ConfigInput} from '../../types.js';
/** Fixed user file, public view and original selected-provider credential port.
 * Identity reads never hydrate a vault or repair config. Secret resolution is
 * deferred to the owned adapter; unavailable stores stay unavailable. */
export function readAssistantModelConfiguration(){
 try{
  const file=getConfigPath(),before=lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>1024*1024)throw Error();
  const bytes=readFileSync(file),after=lstatSync(file);
  if(bytes.length>1024*1024||after.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.size!==after.size)throw Error();
  const snapshot=new ProtectedJsonFile(file).readPublic(),raw=snapshot.value as ConfigInput|undefined;
  if(snapshot.digest!==createHash('sha256').update(bytes).digest('hex')||!raw||typeof raw!=='object'||!('schemaVersion' in raw)||![1,2].includes(raw.schemaVersion))throw Error();
  const config:Config=normalizeConfig(raw);
  const transports=Object.keys(config.providers).sort().map(providerId=>{const transport=resolveProviderTransport(config,providerId);return {...transport,headers:Object.fromEntries(Object.entries(transport.headers).sort(([a],[b])=>a<b?-1:a>b?1:0))};});
  const configFingerprint=createHash('sha256').update('assistant-effective-model-identity-v2\0').update(bytes).update('\0').update(JSON.stringify(transports)).digest('hex');
  const identity={modelEpoch:Math.max(1,Math.floor(after.mtimeMs)),configFingerprint};
  const legacyModelField=raw.schemaVersion===1?(raw.defaultModel==='claude'?'claude':raw.defaultModel==='openai'?'openai':'custom'):undefined;
  function transportForModel(modelId:string){
   const selected=resolveConfiguredModelBinding(config,modelId),known=new Set<string>(),initial=resolveProviderTransport(config,selected.providerId);
   if(initial.apiKey)known.add(initial.apiKey);
   const resolve:AdapterCredentialResolver=()=>{
    const resolved=structuredClone(config),provider=resolved.providers[selected.providerId];
    const environmentKey=Boolean(resolveProviderApiKey(config,selected.providerId));
    const legacy=legacyModelField;
    for(const field of snapshot.credentialPaths){
     if(legacy&&field.length===3&&field[0]==='models'&&field[1]===legacy&&field[2]==='apiKey'&&!environmentKey){provider.apiKey=snapshot.resolve(field) as string;if(provider.apiKey)known.add(provider.apiKey);continue;}
     if(field[0]!=='providers'||field[1]!==selected.providerId)continue;
     if(field.length===3&&field[2]==='apiKey'&&!environmentKey)provider.apiKey=snapshot.resolve(field) as string;
     if(field.length===4&&field[2]==='headers'){const value=snapshot.resolve(field) as string;provider.headers={...provider.headers,[field[3]!]:value};if(value)known.add(value);}
    }
    snapshot.resolve([]);const actual=resolveRuntimeModelBinding(resolved,modelId);
    if(actual.apiKey)known.add(actual.apiKey);
    return {apiKey:actual.apiKey,headers:actual.headers};
   };
   return Object.freeze({resolve,knownSecrets:()=>Object.freeze([...known])});
  }
  return {config,identity,transportForModel};
 }catch{throw Error('assistant_model_configuration_unavailable');}
}
/** No secret-bearing transport or standalone key hash crosses this boundary. */
export function readAssistantModelIdentity(){return readAssistantModelConfiguration().identity;}

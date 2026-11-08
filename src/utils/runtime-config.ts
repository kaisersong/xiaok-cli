import type {Config,LegacyConfig,ModelAdapter} from '../types.js';
import {DEFAULT_CONFIG,isValidLegacyProvider} from '../types.js';
import {ProtectedJsonFile} from './protected-json.js';
import {getConfigPath} from './config.js';
import {normalizeConfig} from '../ai/providers/normalize.js';
import {resolveConfiguredModelBinding} from '../ai/providers/model-binding.js';
import {resolveProviderApiKey} from '../ai/providers/auth-resolver.js';
import {resolveRuntimeModelBinding} from '../ai/providers/control-plane.js';
import {createAdapter,resolveOpenAICompatibilityHeaders} from '../ai/models.js';

/** No secrets, migrations, keyring access or writes occur while opening chat. */
export function loadRuntimeConfig(){
  const store=new ProtectedJsonFile(getConfigPath()),snapshot=store.readPublic();
  const raw=snapshot.value;
  if(raw&&raw.schemaVersion!==1&&raw.schemaVersion!==2)throw Error('credential_config_corrupt');
  if(raw?.schemaVersion===1&&raw.defaultModel!==undefined&&!isValidLegacyProvider(raw.defaultModel))throw Error('credential_config_corrupt');
  const config=raw?normalizeConfig(raw as unknown as Config|LegacyConfig):structuredClone(DEFAULT_CONFIG);
  const legacyApiPath=['models',String(raw?.defaultModel),'apiKey'];
  const selectedProvider=resolveConfiguredModelBinding(config).providerId;
  const hasModelCredentials=snapshot.credentialPaths.some(path=>raw?.schemaVersion===1?JSON.stringify(path)===JSON.stringify(legacyApiPath):path[0]==='providers'&&path[1]===selectedProvider&&['apiKey','headers'].includes(path[2]));
  freezePublicConfig(config);
  return {config,hasModelCredentials,hasCredentials:snapshot.credentialPaths.length>0,
    resolveTransport:()=>{
      const {providerId}=resolveConfiguredModelBinding(config);
      const resolved=structuredClone(config);
      const provider=resolved.providers[providerId];
      const hasEnvironmentKey=Boolean(resolveProviderApiKey(config,providerId));
      try{
        for(const path of snapshot.credentialPaths){
          if(raw?.schemaVersion===1){
            if(path[0]==='models'&&path[1]===raw.defaultModel&&path[2]==='apiKey'&&!hasEnvironmentKey)provider.apiKey=snapshot.resolve(path) as string;
          }else if(path[0]==='providers'&&path[1]===providerId){
            if(path.length===3&&path[2]==='apiKey'&&!hasEnvironmentKey)provider.apiKey=snapshot.resolve(path) as string;
            if(path.length===4&&path[2]==='headers')provider.headers={...provider.headers,[path[3]]:snapshot.resolve(path) as string};
          }
        }
        // Also check the version for env-only and unauthenticated providers.
        snapshot.resolve([]);
        const binding=resolveRuntimeModelBinding(resolved);
        return {apiKey:binding.apiKey,headers:binding.headers};
      }catch(error){
        if(error instanceof Error&&['credential_store_unavailable','credential_missing'].includes(error.message)){
          throw new Error('无法读取此功能需要的凭证。请解锁系统钥匙串后重试；会话仍可继续使用本地命令。',{cause:error});
        }
        throw error;
      }
    },
    selectModel:(next:Config)=>{
      store.updateModelSelection(next.models as unknown as Record<string,unknown>,next.defaultProvider,next.defaultModelId,snapshot.digest,config as unknown as Record<string,unknown>);
      return loadRuntimeConfig();
    },
  };
}
export type RuntimeConfig=ReturnType<typeof loadRuntimeConfig>;

export function createRuntimeAdapter(runtime:RuntimeConfig):ModelAdapter{
  const binding=resolveRuntimeModelBinding(runtime.config,undefined,false);
  return createAdapter(runtime.config,()=>{
    const transport=runtime.resolveTransport();
    return {apiKey:transport.apiKey,headers:binding.protocol==='openai_legacy'
      ?resolveOpenAICompatibilityHeaders({...binding,...transport}).resolvedHeaders:transport.headers};
  });
}

function freezePublicConfig(value:unknown):void{if(!value||typeof value!=='object')return;for(const child of Object.values(value))freezePublicConfig(child);Object.freeze(value);}

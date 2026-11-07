import {createRequire} from 'node:module';
export interface CredentialBackend {get(id:string):string|null;put(id:string,value:string):void}
const require=createRequire(import.meta.url);
/** CLI and the dedicated worker only. No plaintext fallback or subprocess argv secrets. */
export function systemCredentialBackend():CredentialBackend {
  const entry=(id:string)=>{
    if((process as NodeJS.Process & {type?:string}).type==='browser')throw Error('credential_worker_required');
    try {const {Entry}=require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');return new Entry('com.xiaok.credentials.v1',id,{linux:{store:'secret-service'}});}
    catch {throw Error('credential_store_unavailable');}
  };
  return {get(id){try{return entry(id).getPassword();}catch{throw Error('credential_store_unavailable');}},put(id,value){try{entry(id).setPassword(value);}catch{throw Error('credential_store_unavailable');}}};
}

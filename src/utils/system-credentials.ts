import {join} from 'node:path';
import {homedir} from 'node:os';
import {CredentialStore,type CredentialStoreKind} from './credential-store.js';
import {loadFixedKeyringEntry} from './fixed-keyring-native.js';
export interface CredentialBackend {get(id:string):string|null;put(id:string,value:string):void}
/** OS backend remains explicit; no shell arguments carry credential values. */
function keychainCredentialBackend():CredentialBackend {
  const entry=(id:string)=>{
    if((process as NodeJS.Process & {type?:string}).type==='browser')throw Error('credential_worker_required');
    try {const Entry=loadFixedKeyringEntry();return new Entry('com.xiaok.credentials.v1',id,{linux:{store:'secret-service'}});}
    catch {throw Error('credential_store_unavailable');}
  };
  return {get(id){try{return entry(id).getPassword();}catch{throw Error('credential_store_unavailable');}},put(id,value){try{entry(id).setPassword(value);}catch{throw Error('credential_store_unavailable');}}};
}

function store():CredentialStore{
  if((process as NodeJS.Process&{type?:string}).type==='browser')throw Error('credential_worker_required');
  return new CredentialStore(process.env.XIAOK_CONFIG_DIR??join(homedir(),'.xiaok'),keychainCredentialBackend());
}
/** CLI/credential worker: default file, optionally keychain. */
export function systemCredentialBackend():CredentialBackend{
  return {get:id=>store().get(id),put:(id,value)=>store().put(id,value)};
}
export function getCredentialStore():CredentialStoreKind{return store().kind();}
export function setCredentialStore(kind:CredentialStoreKind):void{store().select(kind);}

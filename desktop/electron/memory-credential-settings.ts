import {isSensitiveCredentialPath} from '../../src/shared/credential-fields.js';
import {join} from 'node:path';
import {readProtectedJson,readProtectedJsonVersioned,saveProtectedJson} from '../../src/utils/protected-json-async.js';
const MASK='••••••••';
function project(value:unknown,path:string[]=[]):unknown{if(Array.isArray(value))return value.map((v,i)=>project(v,[...path,String(i)]));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,isSensitiveCredentialPath([...path,k])&&typeof v==='string'&&v?MASK:project(v,[...path,k])]));return value;}
function capture(input:unknown):Record<string,unknown>{try{if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>65536)throw Error();const value=structuredClone(input) as Record<string,unknown>;if('$xiaokCredentials' in value)throw Error();return value;}catch{throw Error('credential_invalid_input');}}
function mergeMasks(input:unknown,old:unknown,path:string[]=[]):unknown {
 if(input===MASK&&isSensitiveCredentialPath(path)){if(typeof old!=='string'||!old)throw Error('credential_config_changed');return old;}
 if(Array.isArray(input))return input.map((v,i)=>mergeMasks(v,Array.isArray(old)?old[i]:undefined,[...path,String(i)]));
 if(input&&typeof input==='object')return Object.fromEntries(Object.entries(input).map(([k,v])=>[k,mergeMasks(v,old&&typeof old==='object'?(old as Record<string,unknown>)[k]:undefined,[...path,k])]));
 return input;
}
export class MemoryCredentialSettingsStore {
 private readonly file:string;
 constructor(root:string){this.file=join(root,'memory-connectors.json');}
 async get(legacy:unknown,source:'user'|'agent'|'scheduler'):Promise<Record<string,unknown>>{if(source!=='user')throw Error('credential_user_only');let value=await readProtectedJson(this.file);if(!value&&legacy!==undefined){const captured=capture(legacy);try{await saveProtectedJson(this.file,captured,'missing');value=captured;}catch(error){if(error instanceof Error&&error.message==='credential_config_changed')value=await readProtectedJson(this.file);else throw error;}}return project(value??{enabled:true,provider:'notebook'}) as Record<string,unknown>;}
 async save(input:unknown,source:'user'|'agent'|'scheduler'):Promise<Record<string,unknown>>{if(source!=='user')throw Error('credential_user_only');const captured=capture(input),snapshot=await readProtectedJsonVersioned(this.file);const next=mergeMasks(captured,snapshot.value??{});await saveProtectedJson(this.file,next,snapshot.digest);return project(next) as Record<string,unknown>;}
}

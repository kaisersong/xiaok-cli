import {isSensitiveCredentialPath} from '../shared/credential-fields.js';
export {isSensitiveCredentialPath} from '../shared/credential-fields.js';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,realpathSync,readFileSync,writeFileSync,renameSync,rmSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {dirname,basename,join,resolve} from 'node:path';
import {systemCredentialBackend,type CredentialBackend} from './system-credentials.js';
const META='$xiaokCredentials',PREFIX='xiaok-secret:v1:';
const reference=/^xiaok-secret:v1:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
interface Ref {path:string[];ref:string}
interface Sealed {version:1;entries:Ref[]}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function backendFailure(error:unknown):never{
  if(error instanceof Error&&/^credential_(config_busy|config_changed|config_corrupt|path_unsafe|store_full|worker_required)$/.test(error.message))throw error;
  throw Error('credential_store_unavailable');
}
export const protectedJsonDigest=(file:string)=>existsSync(file)?hash(readFileSync(file,'utf8')):'missing';

function getAt(value:unknown,path:string[]):unknown {let node=value;for(const key of path){if(!object(node)&&!Array.isArray(node))return;node=(node as Record<string,unknown>)[key];}return node;}
function setAt(value:unknown,path:string[],content:unknown){let node=value as Record<string,unknown>;for(const key of path.slice(0,-1)){if(!object(node[key])&&!Array.isArray(node[key]))node[key]={};node=node[key] as Record<string,unknown>;}if(content===undefined)delete node[path.at(-1)!];else node[path.at(-1)!]=content;}
function entries(value:unknown,path:string[]=[]):Array<{path:string[];value:string}>{
 if(!object(value)&&!Array.isArray(value))return [];
 return Object.entries(value).flatMap(([key,v])=>{if(key===META){if(path.length)throw Error('credential_reserved_input');return [];}const slot=[...path,key];if(isSensitiveCredentialPath(slot)){if(v===undefined||v===null)return [];if(typeof v!=='string')throw Error('credential_invalid_input');return [{path:slot,value:v}];}return entries(v,slot);});
}
function parse(raw:string):Record<string,unknown>{try{const v:unknown=JSON.parse(raw);if(!object(v))throw Error();return v;}catch{throw Error('credential_config_corrupt');}}
/** Sensitive fields are absent from this JSON file; only owner/field-bound credential references remain. */
export class ProtectedJsonFile {
  readonly file:string;private readonly owner:string;
  constructor(file:string,private readonly backend:CredentialBackend=systemCredentialBackend()){
    mkdirSync(dirname(resolve(file)),{recursive:true});this.file=join(realpathSync(dirname(resolve(file))),basename(file));const canonical=process.platform==='win32'?this.file.toLowerCase():this.file;this.owner=hash(canonical);
  }
  private check(file:string){if(existsSync(file)&&(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()))throw Error('credential_path_unsafe');}
  private refs(value:Record<string,unknown>):Ref[]{const raw=value[META];if(raw===undefined)return [];if(!object(raw)||raw.version!==1||!Array.isArray(raw.entries)||raw.entries.length>256)throw Error('credential_binding_invalid');const seen=new Set<string>();return raw.entries.map((row:unknown)=>{if(!object(row)||!Array.isArray(row.path)||!row.path.length||!row.path.every(k=>typeof k==='string'&&k.length>0&&!['__proto__','prototype','constructor',META].includes(k))||typeof row.ref!=='string'||!reference.test(row.ref)||!isSensitiveCredentialPath(row.path as string[]))throw Error('credential_binding_invalid');const path=row.path as string[],key=JSON.stringify(path);if(seen.has(key))throw Error('credential_binding_invalid');seen.add(key);return {path,ref:row.ref};});}
  private reveal(ref:Ref):string {
    let encoded:string|null;try{encoded=this.backend.get(ref.ref.slice(PREFIX.length));}catch(error){backendFailure(error);}
    if(encoded===null)throw Error('credential_missing');let value:unknown;try{value=JSON.parse(encoded);}catch{throw Error('credential_binding_invalid');}
    if(!object(value)||value.owner!==this.owner||JSON.stringify(value.path)!==JSON.stringify(ref.path)||typeof value.value!=='string')throw Error('credential_binding_invalid');return value.value;
  }
  private hydrate(raw:Record<string,unknown>):Record<string,unknown>{const next=structuredClone(raw);for(const r of this.refs(raw))if(getAt(next,r.path)===undefined)setAt(next,r.path,this.reveal(r));delete next[META];return next;}
  private seal(input:Record<string,unknown>,previous?:Record<string,unknown>):Record<string,unknown>{const next=structuredClone(input);delete next[META];const previousRefs=this.refs(previous??{}),refs:Ref[]=[];const slots=entries(next);if(slots.length>256)throw Error('credential_limit');for(const slot of slots){if(slot.path.some(k=>['__proto__','prototype','constructor',META].includes(k)))throw Error('credential_reserved_input');if(!slot.value)continue;if(slot.value.startsWith(PREFIX))throw Error('credential_reserved_input');const old=previousRefs.find(r=>JSON.stringify(r.path)===JSON.stringify(slot.path));let ref:Ref;if(old&&this.reveal(old)===slot.value)ref=old;else{ref={path:slot.path,ref:PREFIX+randomUUID()};const encoded=JSON.stringify({owner:this.owner,path:slot.path,value:slot.value});try{this.backend.put(ref.ref.slice(PREFIX.length),encoded);if(this.backend.get(ref.ref.slice(PREFIX.length))!==encoded)throw Error();}catch(error){backendFailure(error);}}refs.push(ref);setAt(next,slot.path,undefined);}if(refs.length)next[META]={version:1,entries:refs} satisfies Sealed;return next;}
  private atomic(file:string,value:Record<string,unknown>,commit?:()=>void){this.check(file);const tmp=join(dirname(file),'.credential-'+randomUUID());let fd:number|undefined;try{const serialized=JSON.stringify(value,null,2);fd=openSync(tmp,'wx',0o600);writeFileSync(fd,serialized);fsyncSync(fd);closeSync(fd);fd=undefined;commit?.();renameSync(tmp,file);return hash(serialized);}finally{if(fd!==undefined)closeSync(fd);rmSync(tmp,{force:true});}}
  private lock<T>(run:()=>T):T{const dir=this.file+'.credentials-lock',nonce=randomUUID(),owner=join(dir,'owner.json');for(let attempt=0;;attempt++){try{mkdirSync(dir,{mode:0o700});break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw Error('credential_config_busy');if(lstatSync(dir).isSymbolicLink()||!lstatSync(dir).isDirectory())throw Error('credential_path_unsafe');this.check(owner);let old:{pid:number;nonce:string};try{old=JSON.parse(readFileSync(owner,'utf8'));if(!Number.isSafeInteger(old.pid)||old.pid<=0||typeof old.nonce!=='string')throw Error();}catch{throw Error('credential_config_busy');}let dead=false;try{process.kill(old.pid,0);}catch(e){dead=(e as NodeJS.ErrnoException).code==='ESRCH';}if(!dead||attempt>0)throw Error('credential_config_busy');const stale=dir+'.stale-'+nonce;try{renameSync(dir,stale);rmSync(stale,{recursive:true});}catch{throw Error('credential_config_busy');}}}
    try{writeFileSync(owner,JSON.stringify({pid:process.pid,nonce}),{flag:'wx',mode:0o600});return run();}finally{try{if(JSON.parse(readFileSync(owner,'utf8')).nonce===nonce){rmSync(owner);rmSync(dir,{recursive:true});}}catch{/* Keep an unverifiable lock closed. */}}
  }
  private raw(file=this.file){this.check(file);return existsSync(file)?parse(readFileSync(file,'utf8')):undefined;}
  private needsMigration(raw:Record<string,unknown>){return entries(raw).some(e=>Boolean(e.value));}
  /** A read-only, credential-free view. Resolution stays bound to this file revision. */
  readPublic() {
    this.check(this.file);this.check(this.file+'.bak');let digest=protectedJsonDigest(this.file),backupDigest=protectedJsonDigest(this.file+'.bak'),raw=this.raw();
    if(protectedJsonDigest(this.file)!==digest||protectedJsonDigest(this.file+'.bak')!==backupDigest)throw Error('credential_config_changed');
    const refs=this.refs(raw??{}),plaintext=entries(raw??{}),value=raw?structuredClone(raw):undefined;
    const paths=[...refs.map(r=>r.path),...plaintext.filter(r=>Boolean(r.value)).map(r=>r.path)];
    if(value){delete value[META];for(const path of paths)setAt(value,path,undefined);}
    const current=()=>{this.check(this.file);if(protectedJsonDigest(this.file)!==digest||protectedJsonDigest(this.file+'.bak')!==backupDigest)throw Error('credential_config_changed');};
    return {value,get digest(){return digest;},credentialPaths:paths,credentialVersion:(path:string[]):string=>{
      const ref=this.refs(raw??{}).find(r=>JSON.stringify(r.path)===JSON.stringify(path));
      return hash(JSON.stringify(ref??{path,value:getAt(raw,path)??null}));
    },resolve:(path:string[]):unknown=>{
      current();
      if(!paths.some(p=>JSON.stringify(p)===JSON.stringify(path)))return undefined;
      const backup=this.raw(this.file+'.bak');
      if(plaintext.some(e=>Boolean(e.value))||(backup&&this.needsMigration(backup))){
        // Own migration is serialized and version checked; never use a legacy
        // plaintext credential until its protected replacement is committed.
        this.lock(()=>{
          current();const source=this.raw()!,backup=this.raw(this.file+'.bak');
          const next=this.seal(this.hydrate(source),source);
          const nextBackup=backup?this.seal(this.hydrate(backup),backup):undefined;
          if(nextBackup&&this.needsMigration(backup!))this.atomic(this.file+'.bak',nextBackup);
          this.atomic(this.file,next);raw=next;digest=protectedJsonDigest(this.file);backupDigest=protectedJsonDigest(this.file+'.bak');
        });
        plaintext.splice(0);
      }
      const bound=this.refs(raw??{}).find(r=>JSON.stringify(r.path)===JSON.stringify(path));
      const result=bound?this.reveal(bound):getAt(raw,path);current();return result;
    }};
  }
  assertCompleteCredentials(input:unknown):void {
    const raw=this.raw();for(const ref of this.refs(raw??{}))if(typeof getAt(input,ref.path)!=='string'||!getAt(input,ref.path))throw Error('credential_snapshot_incomplete');
    for(const field of entries(raw??{}))if(field.value&&(typeof getAt(input,field.path)!=='string'||!getAt(input,field.path)))throw Error('credential_snapshot_incomplete');
  }
  /** CLI-only semantic edit: no provider or credential fields are accepted. */
  updateModelSelection(models:Record<string,unknown>,provider:string,model:string,expectedHash:string,initial:Record<string,unknown>={schemaVersion:2,providers:{}}):void {
    const selection={models,defaultProvider:provider,defaultModelId:model};
    if(entries(initial).some(e=>Boolean(e.value)))throw Error('credential_reserved_input');
    if(entries(selection).length)throw Error('credential_reserved_input');
    if(typeof provider!=='string'||typeof model!=='string'||!models||typeof models!=='object'||Array.isArray(models))throw Error('credential_invalid_input');
    for(const entry of Object.values(models)){
      if(!object(entry)||Object.keys(entry).some(k=>!['provider','model','label','capabilities','runtimeOptions'].includes(k)))throw Error('credential_reserved_input');
    }
    this.lock(()=>{if(protectedJsonDigest(this.file)!==expectedHash)throw Error('credential_config_changed');const raw=this.raw()??structuredClone(initial),backup=this.raw(this.file+'.bak');if(raw.schemaVersion!==2||this.needsMigration(raw)||(backup&&this.needsMigration(backup)))throw Error('credential_migration_required');this.refs(raw);this.atomic(this.file,{...raw,...selection});});
  }
  read():Record<string,unknown>|undefined{const raw=this.raw(),backup=this.raw(this.file+'.bak');if(!raw){if(backup&&this.needsMigration(backup))this.lock(()=>{const bak=this.raw(this.file+'.bak')!;this.atomic(this.file+'.bak',this.seal(this.hydrate(bak),bak));});return;}if(!this.needsMigration(raw)&&(!backup||!this.needsMigration(backup)))return this.hydrate(raw);return this.lock(()=>{const current=this.raw()!,bak=this.raw(this.file+'.bak');const next=this.seal(this.hydrate(current),current);const nextBak=bak?this.seal(this.hydrate(bak),bak):undefined;if(nextBak&&this.needsMigration(bak!))this.atomic(this.file+'.bak',nextBak);this.atomic(this.file,next);return this.hydrate(next);});}
  save(input:unknown,expectedHash?:string,commit?:()=>void):{digest:string;backupDigest:string}{if(!object(input)||Object.prototype.hasOwnProperty.call(input,META))throw Error('credential_reserved_input');this.check(this.file);return this.lock(()=>{if(expectedHash!==undefined&&protectedJsonDigest(this.file)!==expectedHash)throw Error('credential_config_changed');const current=this.raw(),bak=this.raw(this.file+'.bak');const next=this.seal(input,current);if(bak&&this.needsMigration(bak))this.atomic(this.file+'.bak',this.seal(this.hydrate(bak),bak));return {digest:this.atomic(this.file,next,commit),backupDigest:protectedJsonDigest(this.file+'.bak')};});}
  update(update:(value:Record<string,unknown>)=>unknown){return this.lock(()=>{const raw=this.raw()??{},next=update(this.hydrate(raw));if(!object(next)||Object.prototype.hasOwnProperty.call(next,META))throw Error('credential_reserved_input');this.atomic(this.file,this.seal(next,raw));return next;});}
  updateAutomation(enabled:boolean,expectedHash?:string,initial:Record<string,unknown>={}):void {this.lock(()=>{if(expectedHash!==undefined&&protectedJsonDigest(this.file)!==expectedHash)throw Error('credential_config_changed');if(entries(initial).some(e=>Boolean(e.value)))throw Error('credential_worker_required');const raw=this.raw()??structuredClone(initial);raw.automations={...(object(raw.automations)?raw.automations:{}),globalBackgroundAutoRunEnabled:enabled};this.atomic(this.file,raw);});}

}

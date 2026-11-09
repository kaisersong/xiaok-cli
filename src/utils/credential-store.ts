import {constants,existsSync,lstatSync,realpathSync,mkdirSync,openSync,closeSync,fstatSync,fchmodSync,readFileSync,writeFileSync,renameSync,rmSync,fsyncSync,type Stats} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import type {CredentialBackend} from './system-credentials.js';

export type CredentialStoreKind='file'|'keychain';
type State={version:1;backend:CredentialStoreKind;entries:Record<string,string>};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const empty=():State=>({version:1,backend:'file',entries:{}});
function fail(code:string):never{throw Error('credential_'+code);}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const present=(path:string)=>{try{lstatSync(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}};
const identity=(path:string)=>{const s=lstatSync(path);return `${s.dev}:${s.ino}`;};
function owned(stat:Stats):void{
  if(process.platform!=='win32'&&stat.uid!==process.getuid?.())fail('path_unsafe');
}

/** Restrict the dedicated Windows bucket even for a custom config directory. */
export function protectCredentialPath(path:string,directory:boolean,platform:NodeJS.Platform=process.platform,run:typeof spawnSync=spawnSync):void{
  if(platform!=='win32')return;
  const script=`$ErrorActionPreference='Stop'; $target=$env:XIAOK_CREDENTIAL_ACL_PATH; $item=Get-Item -LiteralPath $target -Force; if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'unsafe'}; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $owner=(Get-Acl -LiteralPath $target).GetOwner([System.Security.Principal.SecurityIdentifier]).Value; if($owner -ne $sid.Value -and $owner -ne 'S-1-5-32-544'){throw 'owner'}; if($env:XIAOK_CREDENTIAL_ACL_DIRECTORY -eq '1'){$acl=New-Object System.Security.AccessControl.DirectorySecurity; $inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{$acl=New-Object System.Security.AccessControl.FileSecurity; $inherit=[System.Security.AccessControl.InheritanceFlags]::None}; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); foreach($principal in @($sid.Value,'S-1-5-18','S-1-5-32-544')){$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($principal,'FullControl',$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule)}; Set-Acl -LiteralPath $target -AclObject $acl; $check=Get-Acl -LiteralPath $target; if(-not $check.AreAccessRulesProtected){throw 'inheritance'}; foreach($rule in $check.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')){throw 'access'}}`;
  const result=run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,XIAOK_CREDENTIAL_ACL_PATH:path,XIAOK_CREDENTIAL_ACL_DIRECTORY:directory?'1':'0'},stdio:'pipe',windowsHide:true});
  if(result.error||result.status!==0)fail('path_unsafe');
}

const protectedWindowsPaths=new Map<string,string>();
function protectKnownPath(path:string,directory:boolean):void{
  if(process.platform!=='win32')return;
  const stamp=()=>{const s=lstatSync(path);return `${s.dev}:${s.ino}:${s.ctimeMs}:${directory}`;};
  if(protectedWindowsPaths.get(path)===stamp())return;
  protectCredentialPath(path,directory);protectedWindowsPaths.set(path,stamp());
}

/** One private atomic vault. The config still holds only owner/field-bound UUIDs. */
export class CredentialStore implements CredentialBackend{
  constructor(private readonly configRoot:string,private readonly keychain:CredentialBackend){
    if((process as NodeJS.Process&{type?:string}).type==='browser')fail('worker_required');
  }
  private directory(create:boolean):string|undefined{
    const base=resolve(this.configRoot);
    if(!existsSync(base)){if(!create)return;mkdirSync(base,{recursive:true});}
    const root=join(realpathSync(base),'credentials');
    if(!present(root)){if(!create)return;try{mkdirSync(root,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
    const stat=lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink())fail('path_unsafe');owned(stat);
    if(process.platform==='win32')protectKnownPath(root,true);
    else if((stat.mode&0o777)!==0o700){
      const fd=openSync(root,constants.O_RDONLY|(constants.O_DIRECTORY??0)|(constants.O_NOFOLLOW??0));
      try{const opened=fstatSync(fd);owned(opened);if(!opened.isDirectory()||opened.dev!==stat.dev||opened.ino!==stat.ino)fail('path_unsafe');fchmodSync(fd,0o700);if(identity(root)!==`${opened.dev}:${opened.ino}`)fail('path_unsafe');}finally{closeSync(fd);}
    }
    return root;
  }
  private checkFile(path:string):void{
    const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('path_unsafe');owned(stat);
  }
  private text(path:string,root:string):string|undefined{
    const prior=identity(root);let fd:number;
    try{fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;if(['ELOOP','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))fail('path_unsafe');throw error;}
    try{
      const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>8*1024*1024)fail('path_unsafe');owned(stat);this.checkFile(path);
      if(process.platform==='win32')protectKnownPath(path,false);
      else if((stat.mode&0o777)!==0o600)fchmodSync(fd,0o600);
      const result=readFileSync(fd,'utf8'),after=fstatSync(fd),current=lstatSync(path);
      if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.dev!==current.dev||after.ino!==current.ino||identity(root)!==prior)fail('config_changed');
      return result;
    }finally{closeSync(fd);}
  }
  private read(root?:string):State{
    root??=this.directory(false);if(!root)return empty();const text=this.text(join(root,'store.json'),root);if(text===undefined)return empty();
    let raw:unknown;try{raw=JSON.parse(text);}catch{fail('config_corrupt');}
    if(!object(raw)||Object.keys(raw).sort().join(',')!=='backend,entries,version'||raw.version!==1||!['file','keychain'].includes(String(raw.backend))||!object(raw.entries))fail('config_corrupt');
    for(const [id,value] of Object.entries(raw.entries))if(!UUID.test(id)||typeof value!=='string')fail('config_corrupt');
    if(raw.backend==='keychain'&&Object.keys(raw.entries).length)fail('config_corrupt');
    return raw as State;
  }
  private write(root:string,state:State,guard:()=>void):void{
    const serialized=JSON.stringify(state);if(Buffer.byteLength(serialized)>8*1024*1024)fail('store_full');
    guard();const prior=identity(root),file=join(root,'store.json'),temporary=join(root,'.store-'+randomUUID());let fd:number|undefined;
    try{
      if(existsSync(file))this.checkFile(file);
      fd=openSync(temporary,'wx',0o600);protectKnownPath(temporary,false);writeFileSync(fd,serialized);fsyncSync(fd);closeSync(fd);fd=undefined;
      guard();if(identity(root)!==prior)fail('path_unsafe');if(existsSync(file))this.checkFile(file);renameSync(temporary,file);
      // A failed post-commit confirmation is reported; never roll back a newer state.
      guard();if(JSON.stringify(this.read(root))!==serialized)fail('config_changed');guard();
    }finally{if(fd!==undefined)closeSync(fd);rmSync(temporary,{force:true});}
  }
  private locked<T>(body:(state:State,root:string,guard:()=>void)=>T):T{
    const root=this.directory(true)!,rootIdentity=identity(root),lock=join(root,'.lock'),owner=join(lock,'owner.json'),nonce=randomUUID();
    let lockIdentity:string|undefined,ownerPublished=false;
    const guard=()=>{
      const directoryStat=lstatSync(root);owned(directoryStat);if(identity(root)!==rootIdentity||!directoryStat.isDirectory()||directoryStat.isSymbolicLink())fail('config_changed');
      if(lockIdentity!==undefined){
        const lockStat=lstatSync(lock);owned(lockStat);
        if(!lockStat.isDirectory()||lockStat.isSymbolicLink()||`${lockStat.dev}:${lockStat.ino}`!==lockIdentity)fail('config_changed');
        if(ownerPublished){
          let ownerNonce:unknown;try{ownerNonce=JSON.parse(this.text(owner,lock)??'').nonce;}catch{fail('config_changed');}
          if(ownerNonce!==nonce)fail('config_changed');
        }
      }
    };
    for(let attempt=0;;attempt++){
      try{
        guard();mkdirSync(lock,{mode:0o700});
        const acquired=lstatSync(lock);if(!acquired.isDirectory()||acquired.isSymbolicLink())fail('path_unsafe');owned(acquired);
        lockIdentity=`${acquired.dev}:${acquired.ino}`;
        guard();protectKnownPath(lock,true);guard();break;
      }
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
        const stat=lstatSync(lock);if(!stat.isDirectory()||stat.isSymbolicLink())fail('path_unsafe');owned(stat);
        let raw:string|undefined,previous:{pid:number;nonce:string};try{raw=this.text(owner,lock);previous=JSON.parse(raw??'');if(!Number.isSafeInteger(previous.pid)||previous.pid<=0||typeof previous.nonce!=='string')throw Error();}catch{fail('config_busy');}
        let dead=false;try{process.kill(previous.pid,0);}catch(e){dead=(e as NodeJS.ErrnoException).code==='ESRCH';}
        if(!dead||attempt>0)fail('config_busy');
        const priorLock=identity(lock),claim=join(lock,'reaper.json');let claimed=false;
        try{
          try{writeFileSync(claim,nonce,{flag:'wx',mode:0o600});claimed=true;}catch{fail('config_busy');}
          guard();if(identity(lock)!==priorLock||this.text(owner,lock)!==raw)fail('config_busy');
          try{process.kill(previous.pid,0);fail('config_busy');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
          const stale=lock+'.stale-'+nonce;renameSync(lock,stale);rmSync(stale,{recursive:true});
        }finally{if(claimed){try{if(identity(lock)===priorLock&&readFileSync(claim,'utf8')===nonce)rmSync(claim);}catch{}}}
      }
    }
    try{writeFileSync(owner,JSON.stringify({pid:process.pid,nonce}),{flag:'wx',mode:0o600});ownerPublished=true;guard();const result=body(this.read(root),root,guard);guard();return result;}
    finally{try{guard();if(JSON.parse(this.text(owner,lock)??'').nonce===nonce){rmSync(owner);rmSync(lock,{recursive:true});}}catch{/* Unverifiable locks remain closed. */}}
  }
  kind():CredentialStoreKind{return this.read().backend;}
  get(id:string):string|null{
    if(!UUID.test(id))fail('invalid_input');const state=this.read();
    if(state.backend==='keychain')return this.nativeGet(id);
    if(Object.hasOwn(state.entries,id))return state.entries[id]!;
    return this.locked((current,root,guard)=>{
      if(current.backend==='keychain')return this.nativeGet(id);
      if(Object.hasOwn(current.entries,id))return current.entries[id]!;
      const legacy=this.nativeGet(id);if(legacy===null)return null;
      current.entries[id]=legacy;this.write(root,current,guard);return legacy;
    });
  }
  put(id:string,value:string):void{
    if(!UUID.test(id)||typeof value!=='string')fail('invalid_input');
    this.locked((state,root,guard)=>{
      if(state.backend==='keychain'){this.nativePut(id,value);guard();return;}
      state.entries[id]=value;this.write(root,state,guard);
    });
  }
  select(kind:CredentialStoreKind):void{
    if(kind!=='file'&&kind!=='keychain')fail('invalid_input');
    this.locked((state,root,guard)=>{
      if(state.backend===kind)return;
      if(kind==='keychain')for(const [id,value] of Object.entries(state.entries))this.nativePut(id,value);
      this.write(root,{version:1,backend:kind,entries:{}},guard);
    });
  }
  private nativeGet(id:string):string|null{try{return this.keychain.get(id);}catch{fail('store_unavailable');}}
  private nativePut(id:string,value:string):void{try{this.keychain.put(id,value);if(this.keychain.get(id)!==value)fail('store_unavailable');}catch{fail('store_unavailable');}}
}

import {lstatSync,readlinkSync,statSync} from 'node:fs';
import {userInfo} from 'node:os';
import {dirname,isAbsolute,join,parse,resolve,sep} from 'node:path';

type Reason='symlink'|'symlink_target_missing'|'symlink_loop'|'not_directory'|'owner'|'mode'|'unreadable'|'invalid_path';
export class ProfileAccountHomeError extends Error{
 constructor(readonly path:string,readonly reason:Reason){super('profile_source_registry_account');this.name='ProfileAccountHomeError';}
}
function validateBase(base:string,display=base){
 const budget={hops:0};
 if(base.includes('\0')||base.split(sep).includes('..'))throw Error('profile_source_registry_identity');
 const uid=process.getuid?.();
 const fail=(path:string,reason:Reason):never=>{throw new ProfileAccountHomeError(path,reason);};
 function checked<T>(shown:string,work:()=>T):T{
  try{return work();}catch(error){const code=(error as NodeJS.ErrnoException)?.code;if(typeof code==='string'&&/^E[A-Z]+$/.test(code)&&code!=='ENOENT')fail(shown,'unreadable');throw error;}
 }
 function walk(input:string,origin?:string):{path:string;existing:string}{
  const absolute=resolve(input),root=parse(absolute).root;let physical=root,original=root;
  for(const component of absolute.slice(root.length).split(sep).filter(Boolean)){
   const next=join(physical,component);original=join(original,component);const shown=origin??(original===absolute?display:original);
   let stat:ReturnType<typeof lstatSync>;
   try{stat=checked(shown,()=>lstatSync(next));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(origin)fail(origin,'symlink_target_missing');return {path:join(next,absolute.slice(original.length)),existing:physical};}
   if(stat.isSymbolicLink()){
    if(process.platform==='win32'||uid===undefined)fail(shown,'symlink');
    if(++budget.hops>8)fail(shown,'symlink_loop');
    const parent=checked(shown,()=>statSync(physical)),system=stat.uid===0&&parent.uid===0&&(parent.mode&0o022)===0;
    const own=stat.uid===uid&&(parent.uid===0||parent.uid===uid)&&(parent.mode&0o022)===0;
    if(!system&&!own)fail(shown,'symlink');
    try{
    const target=checked(shown,()=>readlinkSync(next));if(target.includes('\0')||target.split(sep).includes('..'))fail(shown,'symlink');
    const resolved=walk(isAbsolute(target)?target:join(physical,target),shown).path,targetStat=checked(shown,()=>statSync(resolved));
    if(!targetStat.isDirectory())fail(shown,'not_directory');
    // Root links in protected root parents and private user links cannot let
    // someone else redirect the registry. Only someone else's mutable redirect is a threat: this user already controls
    // XIAOK_CONFIG_DIR. Registry identity is physical and assertCurrent re-checks it.
    if(system){
     for(let p=resolved;;p=dirname(p)){const stat=checked(shown,()=>statSync(p));if((stat.mode&0o022)!==0&&!(stat.uid===0&&(stat.mode&0o1000)!==0))fail(shown,'symlink');if(dirname(p)===p)break;}
    }
    else{
     if(targetStat.uid!==uid||(targetStat.mode&0o022)!==0)fail(shown,'symlink');
     for(let p=resolved;;p=dirname(p)){if((checked(shown,()=>statSync(p)).mode&0o022)!==0)fail(shown,'symlink');if(dirname(p)===p)break;}
    }
    physical=resolved;
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')fail(shown,'symlink_target_missing');throw error;}
   }else{if(!stat.isDirectory())fail(shown,'not_directory');physical=next;}
  }
  return {path:physical,existing:physical};
 }
 const result=walk(base),stat=checked(display,()=>lstatSync(result.existing));
 if(!stat.isDirectory())fail(display,'not_directory');
 // Plain shared ancestors need not belong to us; the deepest existing base does.
 if(uid!==undefined){if(stat.uid!==uid)fail(display,'owner');if((stat.mode&0o022)!==0)fail(display,'mode');}
 return result.path;
}
/** Config overrides name the .xiaok directory itself. UID remains an OS fact. */
export function resolveProfileAccountHome(){
 const config=process.env.XIAOK_CONFIG_DIR;
 if(config){if(!isAbsolute(config)||config.includes('\0'))throw Error('profile_source_registry_identity');const base=validateBase(config);return {home:dirname(base),base};}
 const candidate=process.env.HOME,selected=candidate&&isAbsolute(candidate)?candidate:userInfo().homedir;
 const home=validateBase(selected),base=validateBase(join(home,'.xiaok'),join(selected,'.xiaok'));return {home,base};
}
export function inspectProfileAccountHome():{ok:true}|{ok:false;path:string;reason:ProfileAccountHomeError['reason']}{
 if(process.platform==='win32')return {ok:true};
 try{resolveProfileAccountHome();return {ok:true};}catch(error){if(error instanceof ProfileAccountHomeError)return {ok:false,path:error.path,reason:error.reason};if(error instanceof Error&&error.message==='profile_source_registry_identity')return {ok:false,path:process.env.XIAOK_CONFIG_DIR||process.env.HOME||userInfo().homedir,reason:'invalid_path'};throw error;}
}

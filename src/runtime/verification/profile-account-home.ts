import {lstatSync} from 'node:fs';
import {userInfo} from 'node:os';
import {dirname,isAbsolute,join,resolve,sep} from 'node:path';

function validateBase(base:string){
 if(base.includes('\0')||base.split(sep).includes('..'))throw Error('profile_source_registry_identity');
 base=resolve(base);
 const uid=process.getuid?.();
 for(let current=base;;current=dirname(current)){
  try{const stat=lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('profile_source_registry_account');
   // Shared ancestors (e.g. /tmp) need not belong to us; the selected base does.
   if(current===base&&uid!==undefined&&(stat.uid!==uid||(stat.mode&0o022)!==0))throw Error('profile_source_registry_account');
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(current===base)validateBase(dirname(base));}
  if(dirname(current)===current)break;
 }
}
/** Config overrides name the .xiaok directory itself. UID remains an OS fact. */
export function resolveProfileAccountHome(){
 const config=process.env.XIAOK_CONFIG_DIR;
 if(config){if(!isAbsolute(config)||config.includes('\0'))throw Error('profile_source_registry_identity');validateBase(config);return {home:dirname(config),base:config};}
 const candidate=process.env.HOME,home=candidate&&isAbsolute(candidate)?candidate:userInfo().homedir;
 validateBase(home);const base=join(home,'.xiaok');validateBase(base);return {home,base};
}

import {userInfo} from 'node:os';
import {dirname,isAbsolute,join} from 'node:path';

/** Config overrides name the .xiaok directory itself. UID remains an OS fact. */
export function resolveProfileAccountHome(){
 const config=process.env.XIAOK_CONFIG_DIR;
 if(config){if(!isAbsolute(config)||config.includes('\0'))throw Error('profile_source_registry_identity');return {home:dirname(config),base:config};}
 const candidate=process.env.HOME,home=candidate&&isAbsolute(candidate)?candidate:userInfo().homedir;
 return {home,base:join(home,'.xiaok')};
}

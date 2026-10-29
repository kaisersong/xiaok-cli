import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,parse} from 'node:path';
import {setProfileTestHome} from '../../support/profile-home-env.js';
import {inspectProfileAccountHome,ProfileAccountHomeError,resolveProfileAccountHome} from '../../../src/runtime/verification/profile-account-home.js';
import {readOrdinaryProfileSources,registerOrdinaryProfileSource} from '../../../src/runtime/verification/ordinary-profile-source-registry.js';
const fake=vi.hoisted(()=>({stats:new Map<string,{uid:number;mode:number}>(),errors:new Map<string,string>()}));
vi.mock('node:fs',async load=>{
 const actual=await load<typeof import('node:fs')>();
 function wrap(fn:typeof actual.lstatSync){return (p:string,options?:unknown)=>{const errorKey=fn===actual.statSync?'stat:'+String(p):String(p);if(fake.errors.has(errorKey))throw Object.assign(Error('mock fs failure'),{code:fake.errors.get(errorKey)});const stat=fn(p,options as never),override=fake.stats.get(String(p));if(!override)return stat;return Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,options&&(options as {bigint?:boolean}).bigint?{uid:BigInt(override.uid),mode:(BigInt(stat.mode)&~0o7777n)|BigInt(override.mode)}:{uid:override.uid,mode:(Number(stat.mode)&~0o7777)|override.mode});};}
 return {...actual,lstatSync:wrap(actual.lstatSync),statSync:wrap(actual.statSync)};
});
vi.mock('../../../src/runtime/verification/migration-markers.js',async load=>({...await load<typeof import('../../../src/runtime/verification/migration-markers.js')>(),readInstalledCurrentProfile:()=>({kind:'ordinary'})}));
let root:string;const uid=process.getuid?.()||123;
function stat(path:string,owner=uid,mode=0o700){fake.stats.set(path,{uid:owner,mode});}
function dir(name:string,owner=uid,mode=0o700){const p=join(root,name);mkdirSync(p,{recursive:true});stat(p,owner,mode);return p;}
function link(name:string,target:string,owner=uid){const p=join(root,name);symlinkSync(target,p,'dir');stat(p,owner);return p;}
function reject(path:string,reason:ProfileAccountHomeError['reason']='symlink'){
 try{resolveProfileAccountHome();throw Error('expected rejection');}catch(error){expect(error).toBeInstanceOf(ProfileAccountHomeError);expect(error).toMatchObject({message:'profile_source_registry_account',path,reason});}
 expect(inspectProfileAccountHome()).toEqual({ok:false,path,reason});
}
describe.skipIf(process.platform==='win32')('profile account physical paths',()=>{
 beforeEach(()=>{vi.spyOn(process,'getuid').mockReturnValue(uid);root=realpathSync(mkdtempSync(join(tmpdir(),'profile-links-')));fake.stats.clear();fake.errors.clear();for(let p=root;;p=dirname(p)){stat(p,uid,0o755);if(p===parse(p).root)break;}setProfileTestHome(root);});
 afterEach(()=>{vi.restoreAllMocks();fake.stats.clear();fake.errors.clear();rmSync(root,{recursive:true,force:true});});
 it('preserves plain paths and missing tails',()=>{expect(resolveProfileAccountHome()).toEqual({home:root,base:join(root,'.xiaok')});expect(inspectProfileAccountHome()).toEqual({ok:true});process.env.XIAOK_CONFIG_DIR=join(root,'missing','tail');expect(resolveProfileAccountHome().base).toBe(join(root,'missing','tail'));});
 it('accepts system links and registers using physical paths',()=>{const target=dir('physical'),alias=link('var',target,0);stat(root,0,0o755);process.env.HOME=alias;expect(resolveProfileAccountHome()).toEqual({home:target,base:join(target,'.xiaok')});dir('physical/.xiaok');const source=dir('source');registerOrdinaryProfileSource({kind:'session-root',directory:source});expect(readOrdinaryProfileSources()!.sources[0]!.directory.canonicalPath).toBe(source);});
 it('accepts private dotfiles links',()=>{const target=dir('physical'),alias=link('dotfiles',target);process.env.HOME=alias;expect(resolveProfileAccountHome().home).toBe(target);});
 it('rejects writable user targets',()=>{const target=dir('physical',uid,0o777),alias=link('dotfiles',target);process.env.HOME=alias;reject(alias);});
 it('rejects writable user link parents',()=>{const alias=link('dotfiles',dir('physical'));stat(root,uid,0o777);process.env.HOME=alias;reject(alias);});
 it('rejects user link parents owned by another non-root user',()=>{const alias=link('dotfiles',dir('physical'));stat(root,uid+1,0o755);process.env.HOME=alias;reject(alias);});
 it('rejects writable physical ancestors of system targets',()=>{dir('shared',0,0o777);const target=dir('shared/home'),alias=link('var',target,0);stat(root,0,0o755);process.env.HOME=alias;reject(alias);});
 it('rejects system target ancestors owned by another non-root user',()=>{dir('shared',uid+1,0o755);const target=dir('shared/home'),alias=link('var',target,0);stat(root,0,0o755);process.env.HOME=alias;reject(alias);});
 it('rejects user target ancestors owned by another non-root user',()=>{dir('shared',uid+1,0o755);const alias=link('dotfiles',dir('shared/home'));process.env.HOME=alias;reject(alias);});
 it('reports unreadable link targets from statSync',()=>{const target=dir('physical'),alias=link('dotfiles',target);process.env.HOME=alias;fake.errors.set('stat:'+target,'EACCES');reject(alias,'unreadable');});
 it('escapes NUL in invalid config path diagnostics',()=>{process.env.XIAOK_CONFIG_DIR=join(root,'bad\0path');expect(inspectProfileAccountHome()).toEqual({ok:false,path:join(root,'bad\\0path'),reason:'invalid_path'});});
 it('rejects sticky system targets owned by a non-root user',()=>{const target=dir('shared',uid,0o1777);dir('shared/home');const alias=link('var',target,0);stat(root,0,0o755);process.env.HOME=join(alias,'home');reject(alias);});
 it('reports unreadable path components',()=>{const home=dir('home');process.env.HOME=home;fake.errors.set(home,'EACCES');reject(home,'unreadable');});
 it('rejects writable system link parents',()=>{const target=dir('physical'),alias=link('var',target,0);stat(root,0,0o777);process.env.HOME=alias;reject(alias);});
 it('allows sticky system targets but still checks the final base',()=>{const target=dir('shared',0,0o777);dir('shared/home');const alias=link('var',target,0);stat(root,0,0o755);process.env.HOME=join(alias,'home');reject(alias);stat(target,0,0o1777);expect(resolveProfileAccountHome().home).toBe(join(target,'home'));});
 it('checks each chained hop',()=>{const target=dir('physical'),container=dir('container',0,0o755),second=link('container/second',target,0),first=link('first',container,0);stat(root,0,0o755);process.env.HOME=join(first,'second');expect(resolveProfileAccountHome().home).toBe(target);stat(second,uid+123);reject(join(first,'second'));});
 it('reports dangling targets',()=>{const alias=link('dangling',join(root,'missing'));process.env.HOME=alias;reject(alias,'symlink_target_missing');});
 it('accepts a private config link and rejects a writable config target',()=>{const target=dir('config'),alias=link('config-link',target);process.env.XIAOK_CONFIG_DIR=alias;expect(resolveProfileAccountHome()).toEqual({home:dirname(target),base:target});stat(target,uid,0o777);reject(alias);});
 it('rejects cycles after eight hops',()=>{const alias=link('cycle',join(root,'cycle'));process.env.HOME=alias;reject(alias,'symlink_loop');});
 it('rejects traversal targets and writable physical ancestors of user links',()=>{const target=dir('physical'),alias=link('dotfiles',target);process.env.HOME=alias;stat(dirname(root),uid,0o1777);reject(alias);});
 it('reports non-directories and strict base permissions',()=>{const file=join(root,'file');writeFileSync(file,'x');process.env.HOME=file;reject(file,'not_directory');process.env.HOME=root;stat(root,uid+1);reject(root,'owner');stat(root,uid,0o777);reject(root,'mode');});
 it('rejects traversal in original paths and link targets',()=>{process.env.XIAOK_CONFIG_DIR=join(root,'config')+'/../other';expect(()=>resolveProfileAccountHome()).toThrow('profile_source_registry_identity');expect(inspectProfileAccountHome()).toEqual({ok:false,path:process.env.XIAOK_CONFIG_DIR,reason:'invalid_path'});delete process.env.XIAOK_CONFIG_DIR;const alias=link('traversal','../outside');process.env.HOME=alias;reject(alias);});
 it('rejects target directories reached through a missing tail',()=>{const alias=link('missing-tail',join(root,'missing','child'));process.env.HOME=alias;reject(alias,'symlink_target_missing');});
 it('rejects every link without a process uid',()=>{const alias=link('unsupported',dir('physical'));process.env.HOME=alias;const getuid=process.getuid;try{Object.defineProperty(process,'getuid',{value:undefined,configurable:true});reject(alias);}finally{Object.defineProperty(process,'getuid',{value:getuid,configurable:true});}});

 it('allows eight hops and rejects a ninth',()=>{const target=dir('physical');let head=target;for(let n=0;n<8;n++)head=link('hop'+n,head);process.env.HOME=head;expect(resolveProfileAccountHome().home).toBe(target);const ninth=link('ninth',head);process.env.HOME=ninth;reject(ninth,'symlink_loop');});
 it('uses separate hop budgets for HOME and config',()=>{const target=dir('physical'),config=dir('config-target');symlinkSync(config,join(target,'.xiaok'));stat(join(target,'.xiaok'));let head=target;for(let n=0;n<8;n++)head=link('home-hop'+n,head);process.env.HOME=head;expect(resolveProfileAccountHome()).toEqual({home:target,base:config});});
 it('preserves the HOME alias in config diagnostics',()=>{const target=dir('physical'),config=dir('config-target',uid,0o777),alias=link('home-alias',target);symlinkSync(config,join(target,'.xiaok'));stat(join(target,'.xiaok'));process.env.HOME=alias;reject(join(alias,'.xiaok'));});

});

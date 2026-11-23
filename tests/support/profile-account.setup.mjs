import {afterAll,inject,vi} from 'vitest';
import {mkdtempSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
const account=vi.hoisted(()=>({home:undefined}));
// Worker pools snapshot env before globalSetup; pass the actual private path
// through ProvidedContext so fixtures and their real children inherit it.
const privateTemp=inject('profileTestTempRoot');
if(process.platform==='win32'){
 if(typeof privateTemp!=='string'||realpathSync(privateTemp)!==privateTemp)throw Error('test_private_temp_required');
 const previousTemp={TEMP:process.env.TEMP,TMP:process.env.TMP};
 process.env.TEMP=privateTemp;process.env.TMP=privateTemp;
 afterAll(()=>{for(const key of ['TEMP','TMP']){if(previousTemp[key]===undefined)delete process.env[key];else process.env[key]=previousTemp[key];}});
}
const root=inject('profileTestAccountRoot');
if(typeof root!=='string'||!root)throw Error('test_profile_account_root_required');
account.home=realpathSync(mkdtempSync(join(root,'account-')));
const actual=await vi.importActual('node:os'),realHome=actual.userInfo().homedir;
function inside(root,path){const rel=relative(resolve(root),resolve(path));return rel===''||rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(rel);}
function canonical(path){try{return realpathSync(path);}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;const parent=dirname(path);if(parent===path)return path;return join(canonical(parent),relative(parent,path));}}
delete process.env.XIAOK_CONFIG_DIR;
process.env.HOME=account.home;
if(process.platform==='win32')process.env.USERPROFILE=account.home;
const base=process.env.XIAOK_CONFIG_DIR||join(process.env.HOME&&isAbsolute(process.env.HOME)?process.env.HOME:realHome,'.xiaok'),profileRoot=canonical(resolve(base,'profile-sources'));
if(!isAbsolute(base)||inside(canonical(realHome),profileRoot)||!inside(canonical(account.home),profileRoot))throw Error('test_profile_home_not_isolated');
vi.mock('node:os',async original=>{
 const actual=await original();
 const userInfo=options=>{
  if(!account.home)throw Error('test_profile_account_not_ready');
  const info=actual.userInfo(options);
  return {...info,homedir:Buffer.isBuffer(info.homedir)?Buffer.from(account.home):account.home};
 };
 return {...actual,userInfo,default:{...actual.default,userInfo}};
});

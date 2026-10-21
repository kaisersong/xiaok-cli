import fs from 'node:fs';
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import {resolve} from 'node:path';

const accountHome=process.env.XIAOK_TEST_ACCOUNT_HOME;
if(!accountHome)throw Error('test_profile_account_home_required');
const runtimeHome=process.env.XIAOK_TEST_RUNTIME_HOME??accountHome;
process.env.HOME=runtimeHome;
process.env.USERPROFILE=runtimeHome;
const originalUserInfo=os.userInfo.bind(os);
os.homedir=()=>runtimeHome;
os.userInfo=options=>{
 const info=originalUserInfo(options);
 return {...info,homedir:Buffer.isBuffer(info.homedir)?Buffer.from(accountHome):accountHome};
};

const devicePath=process.env.XIAOK_TEST_DEVICE_PATH;
const deviceOffset=BigInt(process.env.XIAOK_TEST_DEVICE_OFFSET??'0');
if(devicePath&&deviceOffset!==0n){
 const target=resolve(devicePath),originalLstatSync=fs.lstatSync.bind(fs);
 fs.lstatSync=(path,options)=>{
  const stat=originalLstatSync(path,options);
  if(typeof path!=='string'||resolve(path)!==target)return stat;
  return new Proxy(stat,{get(value,key){if(key==='dev')return typeof value.dev==='bigint'?value.dev+deviceOffset:value.dev+Number(deviceOffset);const field=Reflect.get(value,key,value);return typeof field==='function'?field.bind(value):field;}});
 };
}

syncBuiltinESMExports();

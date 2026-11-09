import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const helper=path.join(root,'desktop/scripts/prepare-packaged-yzj-cli.cjs');
const require=createRequire(helper),actual=require(helper);
const installed=process.env.XIAOK_YZJ_PREPARE_TEST_PACKAGE??path.join(root,'desktop/node_modules/@yunzhijia/cli');
const own=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'yzj-package-test-')));
after(()=>fs.rmSync(own,{recursive:true,force:true}));
let index=0;
function fixture(binary=true){
 const desktop=path.join(own,String(++index)),pkg=path.join(desktop,'node_modules/@yunzhijia/cli');
 fs.mkdirSync(path.join(pkg,'scripts'),{recursive:true});
 for(const name of ['package.json','scripts/install.js'])fs.copyFileSync(path.join(installed,name),path.join(pkg,name));
 const name=process.platform==='win32'?'yzj-cli.exe':'yzj-cli';
 if(binary){fs.mkdirSync(path.join(pkg,'bin'));fs.copyFileSync(path.join(installed,'bin',name),path.join(pkg,'bin',name),fs.constants.COPYFILE_FICLONE);}
 return{desktop,pkg,binary:path.join(pkg,'bin',name)};
}
function isolated(spawnSync,env={}){
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(helper,'utf8'),{module,exports:module.exports,__dirname:path.dirname(helper),
  process:{...process,env:{...process.env,...env}},Buffer,console,
  require(name){return name==='node:child_process'?{spawnSync}:require(name);}}, {filename:helper});
 return module.exports;
}
function retainedCapsule(error){
 assert.match(error.message,/^yzj_package_prepare_unconfirmed: /);
 const capsule=error.message.slice('yzj_package_prepare_unconfirmed: '.length);
 assert.ok(fs.existsSync(capsule));assert.equal(fs.existsSync(path.join(capsule,'skills')),false);
 return capsule;
}
test('existing real host binary passes original target/version verifier without reinstall or global env mutation',()=>{
 const f=fixture(),before={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE,XIAOK_CONFIG_DIR:process.env.XIAOK_CONFIG_DIR};
 const value=actual.preparePackagedYzjCli(f.desktop);
 assert.equal(value.prepared,false);assert.equal(value.version,'0.1.8');assert.equal(value.runtimeVerified,true);
 assert.deepEqual({HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE,XIAOK_CONFIG_DIR:process.env.XIAOK_CONFIG_DIR},before);
});
test('a changed original installer rejects before invoking any process',()=>{
 const f=fixture(false);fs.appendFileSync(path.join(f.pkg,'scripts/install.js'),'\n// altered');let calls=0;
 const m=isolated(()=>{calls++;throw Error('unexpected_process');});
 assert.throws(()=>m.preparePackagedYzjCli(f.desktop),/installer_not_locked/);assert.equal(calls,0);
});
test('an existing wrong binary is not replaced or treated as an install prerequisite',()=>{
 const f=fixture();fs.writeFileSync(f.binary,'invalid-binary');let calls=0;
 const m=isolated(()=>{calls++;throw Error('unexpected_process');});
 let raw;try{m.preparePackagedYzjCli(f.desktop);}catch(error){raw=error;}
 const capsule=retainedCapsule(raw);assert.match(raw.cause.message,/target mismatch/);assert.equal(calls,0);
 assert.equal(fs.readFileSync(f.binary,'utf8'),'invalid-binary');fs.rmSync(capsule,{recursive:true});
});
test('a junction or symlink bin directory cannot adopt or overwrite an outside binary',()=>{
 const f=fixture(false),outside=path.join(own,'outside-'+index);fs.mkdirSync(outside);
 const name=path.basename(f.binary);fs.copyFileSync(path.join(installed,'bin',name),path.join(outside,name));
 fs.symlinkSync(outside,path.join(f.pkg,'bin'),process.platform==='win32'?'junction':'dir');
 let calls=0;const m=isolated(()=>{calls++;throw Error('unexpected_process');});
 let raw;try{m.preparePackagedYzjCli(f.desktop);}catch(error){raw=error;}
 const capsule=retainedCapsule(raw);assert.match(raw.cause.message,/directory_alias/);assert.equal(calls,0);
 fs.rmSync(capsule,{recursive:true});
});
test('a hardlinked existing executable fails the original no-alias boundary',()=>{
 const f=fixture(),other=path.join(own,'hardlink-'+index);fs.linkSync(f.binary,other);let raw;
 try{actual.preparePackagedYzjCli(f.desktop);}catch(error){raw=error;}
 const capsule=retainedCapsule(raw);assert.match(raw.cause.message,/input_alias/);fs.rmSync(capsule,{recursive:true});
});
test('original installer exit0 without a binary still fails and preserves its raw diagnostic result',()=>{
 const f=fixture(false),result={status:0,stdout:'',stderr:'vendor download failed'},calls=[];
 const m=isolated((file,args,options)=>{calls.push({file,args,options});return result;},
  {NODE_OPTIONS:'--require=bad',Node_Path:'bad',DYLD_INSERT_LIBRARIES:'bad',TOP_SECRET_API_KEY:'never'});
 let raw;try{m.preparePackagedYzjCli(f.desktop);}catch(error){raw=error;}
 const capsule=retainedCapsule(raw);assert.match(raw.cause.message,/did_not_prepare_binary/);
 assert.equal(raw.cause.installerResult,result);assert.equal(calls.length,1);
 const {file,args,options}=calls[0];assert.equal(file,process.execPath);assert.equal(args[0],path.join(capsule,'scripts/install.js'));
 assert.deepEqual(fs.readFileSync(args[0]),fs.readFileSync(path.join(installed,'scripts/install.js')));
 assert.equal(options.env.PYTHONDONTWRITEBYTECODE,'1');assert.equal(options.env.PYTHONNOUSERSITE,'1');
 for(const key of ['NODE_OPTIONS','Node_Path','DYLD_INSERT_LIBRARIES','TOP_SECRET_API_KEY'])assert.equal(Object.hasOwn(options.env,key),false);
 assert.equal(options.env.HOME,process.env.HOME);assert.equal(options.env.USERPROFILE,process.env.USERPROFILE);
 assert.ok(fs.statSync(options.env.XIAOK_CONFIG_DIR).isDirectory());assert.equal(options.env.TMPDIR,path.join(capsule,'tmp'));
 fs.rmSync(capsule,{recursive:true});
});
test('a process timeout retains the exact error and private capsule instead of claiming install success',()=>{
 const f=fixture(false),sentinel=Object.assign(new Error('timeout'),{code:'ETIMEDOUT'});
 const m=isolated(()=>({status:null,error:sentinel}));let raw;
 try{m.preparePackagedYzjCli(f.desktop);}catch(error){raw=error;}
 const capsule=retainedCapsule(raw);assert.equal(raw.cause.cause,sentinel);assert.equal(fs.existsSync(f.binary),false);
 // Fixed fault simulation did not start a process; only its own fixture is removed.
 fs.rmSync(capsule,{recursive:true});
});

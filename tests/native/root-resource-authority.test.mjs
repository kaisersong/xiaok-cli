import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,realpathSync,renameSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
// Compiled fixture identity is a dedicated Native domain, not a runtime path
// parameter or a production resource/Host grant. Nothing opens a user's DB.
test('the original Native resource connection installs an immutable floor and owns its sole issuer', {skip:process.platform!=='darwin'},t=>{
 const root=mkdtempSync(join(tmpdir(),'xiaok-native-resource-')),domain=join(root,'domain');mkdirSync(domain);const sessions=[],databases=[];
 t.after(()=>{for(const [owner,value]of sessions)owner.close(value);for(const db of databases)db.close();rmSync(root,{recursive:true,force:true});console.log(JSON.stringify({fixture:'native-resource-floor',childProcessesRemaining:0,notProductionResourceFinish:true}));});
 const sdk=spawnSync('xcrun',['--show-sdk-path'],{encoding:'utf8'});assert.equal(sdk.status,0,sdk.stderr);
 const headers=join(homedir(),'Library/Caches/node-gyp/24.16.0/include/node');
 const source=join(repo,'native/root-resource-authority/root_resource_authority.c');
 const compile=(output,fixture)=>{const args=['-std=c11','-Werror','-Wno-deprecated-declarations','-bundle','-undefined','dynamic_lookup','-isysroot',sdk.stdout.trim(),'-I',headers,'-DNAPI_VERSION=8',...(fixture?['-DNR_FIXTURE_BUILD=1','-DNR_FIXTURE_ROOT='+JSON.stringify(realpathSync(domain))]:[]),source,'-lsqlite3','-o',output];const built=spawnSync('cc',args,{encoding:'utf8'});assert.equal(built.status,0,built.stderr);};
 const addon=join(root,'resource-fixture.node'),production=join(root,'resource-production.node');compile(addon,true);compile(production,false);
 const native=require(addon),prod=require(production);assert.equal(prod.buildInfo().buildKind,'production_component');assert.equal(prod.buildInfo().nativeQualified,false);assert.equal(native.buildInfo().buildKind,'fixture');assert.equal(native.buildInfo().semanticDigest,createHash('sha256').update(readFileSync(join(repo,'native/root-resource-authority/reservation-contract.json'))).digest('hex'));
 assert.equal(native.fixtureSubject,undefined);assert.equal(native.exec,undefined);assert.equal(native.finish,undefined);
 assert.throws(()=>native.openOriginal(domain),/ARGUMENT/);
 const session=(()=>{try{return native.openOriginal();}catch(error){console.log(JSON.stringify({nativeStage:error.nativeStage,sqliteCode:error.sqliteCode,sqliteExtendedCode:error.sqliteExtendedCode,osError:error.osError}));throw error;}})();sessions.push([native,session]);assert.equal(Object.keys(session).length,0);
 let getters=0;const fake=Object.defineProperty({},'session',{get(){getters++;throw Error('forbidden');}});
 for(const value of [fake,{...session},null])assert.throws(()=>native.readPolicy(value),/SESSION/);assert.equal(getters,0);
 assert.throws(()=>native.readPolicy(session),/FLOOR/);assert.equal(native.installFresh(session).installed,true);assert.throws(()=>prod.readPolicy(session),/SESSION/);assert.throws(()=>prod.close(session),/SESSION/);
 assert.deepEqual(native.readPolicy(session),{capacity:5,queueLimit:256,enqueueSeq:0,claimSeq:0,humanBurst:0,issuerEpoch:1});
 let setters=0,closeFailure;Object.defineProperty(Object.prototype,'capacity',{configurable:true,set(){setters++;try{native.close(session);}catch(error){closeFailure=error;}}});
 try{native.readPolicy(session);}finally{delete Object.prototype.capacity;}
 assert.equal(setters,0);assert.equal(closeFailure,undefined);assert.equal(native.readPolicy(session).capacity,5);

 assert.throws(()=>native.installFresh(session),/FRESH/);
 const child=spawnSync(process.execPath,['-e',`const a=require(${JSON.stringify(addon)});try{a.openOriginal();process.exitCode=9}catch(e){console.log(e.message);process.exitCode=e.message==='ROOT_RESOURCE_ISSUER_BUSY'?0:8}`],{encoding:'utf8'});assert.equal(child.status,0,child.stdout+child.stderr);assert.match(child.stdout,/ISSUER_BUSY/);
 const dbFile=join(domain,'root-resource-v1.sqlite'),old=new DatabaseSync(dbFile);databases.push(old);
 assert.throws(()=>old.prepare('UPDATE root_resource_policy SET human_burst=1 WHERE singleton=1').run(),/no such function/);
 assert.throws(()=>old.exec('DELETE FROM root_resource_floor'),/no such function|immutable/);
 assert.equal(old.prepare('SELECT count(*) AS n FROM root_resources').get().n,0);
 // Same-UID unrestricted raw SQL is an explicitly OPEN I0 parent: these
 // managed-connection guards do not pretend to stop DROP/forged functions.
 native.close(session);assert.throws(()=>native.readPolicy(session),/CLOSED/);
 const reopened=native.openOriginal();sessions.push([native,reopened]);assert.equal(native.readPolicy(reopened).enqueueSeq,0);
 const replaced=join(domain,'retained.sqlite');renameSync(dbFile,replaced);assert.throws(()=>native.readPolicy(reopened),/UNCONFIRMED/);renameSync(replaced,dbFile);assert.throws(()=>native.readPolicy(reopened),/UNCONFIRMED/);native.close(reopened);
});

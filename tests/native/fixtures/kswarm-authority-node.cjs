exports.run=async function(root,ks,scenario){
 const assert=require('node:assert/strict'),{join}=require('node:path'),{mkdirSync,existsSync}=require('node:fs'),{pathToFileURL}=require('node:url');
 const home=process.env.HOME;process.env.XIAOK_CONFIG_DIR=join(root,'config');mkdirSync(process.env.XIAOK_CONFIG_DIR,{recursive:true,mode:0o700});
 const {DSH_ADMISSION_OWNER_WRITER_PROFILE}=await import(pathToFileURL(join(ks,'src/core/initial-plan-acceptance-contract.js')));
 const {createHub}=await import(pathToFileURL(join(ks,'src/core/hub.js'))),{createSqlitePersistence,readOriginalKSwarmPersistenceSource}=await import(pathToFileURL(join(ks,'src/core/sqlite-persistence.js'))),{createProjectInputAuthority}=await import(pathToFileURL(join(ks,'src/core/project-input-authority.js')));
 const filePath=join(root,'ks-business','state.sqlite');let foreignFactoryCalls=0;assert.throws(()=>createSqlitePersistence({filePath,sqliteFactory(){foreignFactoryCalls++;throw Error('foreign factory must not execute');}}),/KSWARM_ORIGINAL_AUTHORITY_FACTORY_DENIED/);assert.equal(foreignFactoryCalls,0);assert.equal(existsSync(filePath),false);
 const store=createSqlitePersistence({filePath}),source=readOriginalKSwarmPersistenceSource(store),authority=createProjectInputAuthority({profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)});
 const hub=createHub({silent:true,persistence:store,dataDir:{backend:'sqlite',filePath}}),control={requestSource:'user',projectInputAuthority:authority.reader()};
 try{
  const prepared=hub.prepareDshAdmissionOwnerWriter(control);assert.equal(prepared.ok,true,JSON.stringify(prepared));
  const observed=hub.inspectDefaultDispatchWriter(control);assert.equal(observed.ok,true);assert.equal(observed.profile.floor.profile,DSH_ADMISSION_OWNER_WRITER_PROFILE);assert.equal(observed.profile.floor.schemaVersion,8);
  source.assertCurrent();assert.equal(existsSync(filePath),false,'protected connection must not open the ordinary path');assert.equal(process.env.HOME,home);
  console.log(JSON.stringify({kind:'ks-original-node-hub',pid:process.pid,profile:observed.profile.floor.profile,storeId:observed.profile.floor.storeId,ordinaryDatabaseAbsent:true,homeUnchanged:true,productionQualified:false}));
 }finally{if(scenario==='no_explicit_finish'){console.log(JSON.stringify({kind:'ks-node-premature-exit',pid:process.pid,exitCode:0,explicitFinish:false}));process.exit(0);}hub.closePersistence();await source.waitKnown();source.assertTerminated();}
 if(scenario==='ignore_term_after_finish'){
  process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
  process.send({kind:'ks-original-ignore-term-ready'});await new Promise(()=>{});
 }
 if(process.channel)process.disconnect();
};

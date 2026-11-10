'use strict';
module.exports=function installedRootPoolMainFixture(options){
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
 process.env.XIAOK_CONFIG_DIR=path.join(options.root,'config');
 const {app,BrowserWindow}=require('electron');
 app.setPath('userData',path.join(options.root,'userData'));
 app.disableHardwareAcceleration();
 app.on('window-all-closed',()=>{});
 app.whenReady().then(async()=>{
  const facts={kind:'original-main-installed-root-pool',pid:process.pid,actualMain:process.type==='browser',electron:process.versions.electron,node:process.versions.node,productionQualified:false};
  let api,realm,store,lease,core,budget,first;
  const secondary=[],held=[];
  globalThis.originalInstalledRootPoolFailures=held;
  const hold=raw=>{held.push(raw);const d=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,'message'):undefined;return {kind:typeof raw,message:d&&Object.hasOwn(d,'value')?d.value:null};};
  try{
   assert.equal(facts.actualMain,true);
   api=await import(require('node:url').pathToFileURL(options.bundle).href);
   realm=api.createMainDshBootstrapAuthority();
   core=api.prepareOriginalMainDshCoreInfrastructure(realm);
   await api.startOriginalMainDshCoreInfrastructure(core);
   facts.coreStartedBeforeStore=true;
   facts.protectedAdmission=api.readOriginalMainDshAdmissionDatabase(realm)!==null;
   assert.equal(facts.protectedAdmission,true);
   if(options.diagnosticBudgetBarrier){
    process.stdout.write(JSON.stringify({kind:'original-main-before-budget',pid:process.pid})+'\n');
    await new Promise(resolve=>{let input='';process.stdin.on('data',function ready(chunk){input+=chunk.toString();if(input==='BUDGET\n'){process.stdin.removeListener('data',ready);process.stdin.pause();resolve();}});});
   }
   budget=await api.createHarnessOptimizationRuntime({dataRoot:path.join(options.root,'budget'),profileId:'fixture-profile',workspaceId:'fixture-workspace',authorizeUser:()=>false,manifestLookup:()=>undefined,originalCoreLease:core});
   const budgetState=await budget.api.read();
   assert.equal(budgetState.status,'ready');
   assert.equal(budgetState.config.enabled,false);
   const budgetWitness=path.join(options.root,'budget-owner-observed.json');
   if(fs.existsSync(budgetWitness))assert.equal(budgetState.ownerId,JSON.parse(fs.readFileSync(budgetWitness,'utf8')).ownerId);
   else fs.writeFileSync(budgetWitness,JSON.stringify({ownerId:budgetState.ownerId}));
   facts.protectedBudgetRuntime=true;
   facts.legacyBudgetDatabaseCreated=fs.existsSync(path.join(options.root,'budget','harness-optimization.sqlite'));
   assert.equal(facts.legacyBudgetDatabaseCreated,false);
   store=new api.DesktopMultiAgentStore(path.join(options.root,'groups.sqlite'),{dshAdmissionSource:realm,dshUserControlSource:null});
   facts.legacyGroupsDatabaseCreated=fs.existsSync(path.join(options.root,'groups.sqlite'));
   assert.equal(facts.legacyGroupsDatabaseCreated,false);
   realm.bindStore(store);
   lease=api.prepareOriginalMainDshInstalledRootPool(realm,store);
   const opening=api.openOriginalMainDshInstalledRootPool(lease);
   assert.equal(api.openOriginalMainDshInstalledRootPool(lease),opening);
   const session=await opening;
   const root=api.loadOriginalMainResourceAuthority();
   facts.bootstrap=await api.readOriginalMainDshCoreBootstrap(lease,session);
   assert.ok(facts.bootstrap==='fresh'||facts.bootstrap==='restored');
   facts.nmpSql=require('./protected-nmp-sql-fragment.cjs').runProtectedNmpSqlFixture(root,session,facts.bootstrap,options.root);
   root.assertOriginalMainIssuerCurrent(session);
   facts.sameLease=api.prepareOriginalMainDshInstalledRootPool(realm,store)===lease;
   assert.equal(facts.sameLease,true);
  }catch(raw){first={raw};facts.first=hold(raw);}
  if(api&&lease)try{await api.returnOriginalMainDshInstalledRootPool(lease);facts.ownerReturned=true;}catch(raw){secondary.push({raw});facts.returnError=hold(raw);}
  if(budget)try{await budget.dispose();facts.budgetDisposed=true;}catch(raw){secondary.push({raw});facts.budgetCloseError=hold(raw);}
  if(store)try{store.close();}catch(raw){secondary.push({raw});}
  if(api&&core)try{await api.closeOriginalMainDshCoreInfrastructure(core);facts.closed=true;}catch(raw){secondary.push({raw});facts.closeError=hold(raw);}
  if(realm)try{realm.seal();}catch(raw){secondary.push({raw});}
  facts.failed=first!==undefined||secondary.length!==0;
  facts.secondaryCount=secondary.length;
  facts.dockVisible=app.dock.isVisible();
  facts.windows=BrowserWindow.getAllWindows().length;
  assert.equal(facts.windows,0);
  fs.writeFileSync(path.join(options.root,'root-pool-main-facts-'+process.pid+'.json'),JSON.stringify(facts,null,2)+'\n');
  process.stdout.write(JSON.stringify(facts)+'\n');
  if(facts.failed){app.exit(1);return;}
  // Parent observes this exact no-window Main, then releases one stdin barrier.
  process.stdout.write(JSON.stringify({kind:'original-main-installed-ready',pid:process.pid,type:process.type,dockVisible:app.dock.isVisible(),execPath:process.execPath,electron:process.versions.electron,node:process.versions.node})+'\n');
  let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',text=>{input+=text;if(input==='STOP\n'){process.stdin.pause();app.exit(0);}});
 }).catch(raw=>{globalThis.originalInstalledRootPoolUnhandled=raw;process.stderr.write(String(raw)+'\n');app.exit(1);});
};

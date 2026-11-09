'use strict';
// Actual Core/Native Main producer, original SQL fragment and fixed ledger
// consumer. No role, session or Native permit is supplied by the parent.
module.exports=function rootNmpLedgerMain(options){
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
 const os=require('node:os'),{syncBuiltinESMExports}=require('node:module');
 const nativeUserInfo=os.userInfo,nativeIdentity=nativeUserInfo(),originalHomeEnv=process.env.HOME;
 process.env.XIAOK_CONFIG_DIR=path.join(options.root,'config');
 const home=path.join(options.root,'account');fs.mkdirSync(home,{recursive:true,mode:0o700});
 os.userInfo=opts=>{const info=nativeUserInfo(opts);return {...info,homedir:Buffer.isBuffer(info.homedir)?Buffer.from(home):home};};os.homedir=()=>home;syncBuiltinESMExports();
 const {app,BrowserWindow}=require('electron');app.setPath('userData',path.join(options.root,'userData'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
 const held=[];globalThis.originalRootLedgerFixtureHeld=held;
 function hold(raw){held.push(raw);const out={kind:typeof raw};if(raw&&typeof raw==='object'&&!require('node:util').types.isProxy(raw))for(const key of ['message','code','stack']){const d=Object.getOwnPropertyDescriptor(raw,key);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string')out[key]=d.value;}return out;}
 function bytes(){return fs.readFileSync(path.join(options.root,'authority','root-resource.sqlite'));}
 function hash(raw){return require('node:crypto').createHash('sha256').update(raw).digest('hex');}
 const cell=c=>c[0]==='text'?Buffer.from(c[1],'hex').toString('utf8'):c[0]==='integer'?c[1]:null;
 function counts(view){const t=name=>view.tables.find(t=>t.name===name).rows;const n=t('root_resources'),p=t('root_physical_resources');return {n:n.length,nHeld:n.filter(r=>['reserved','running','cancel_pending','launch_unknown'].includes(cell(r[8]))).length,nQueued:n.filter(r=>cell(r[8])==='queued').length,nUnknown:n.filter(r=>cell(r[8])==='launch_unknown').length,mHeld:p.filter(r=>cell(r[1])==='1'&&['reserved','unknown'].includes(cell(r[7]))).length,pHeld:p.filter(r=>cell(r[1])==='2'&&['reserved','unknown'].includes(cell(r[7]))&&['direct','workflow_vm','workflow_child_slot'].includes(cell(r[11]))).length,physicalUnknown:p.filter(r=>cell(r[7])==='unknown').length,intents:t('root_physical_receipts').filter(r=>cell(r[1])==='process_intent_v1').length,nReceipts:t('root_resource_receipts').length,pReceipts:t('root_physical_receipts').length,outbox:t('root_launch_outbox').length};}
 app.whenReady().then(async()=>{
  const facts={kind:'original-protected-core-ledger-main',pid:process.pid,actualMain:process.type==='browser',node:process.versions.node,electron:process.versions.electron,productionQualified:false};
  let api,realm,core,budget,store,lease,first;const secondary=[];
  try{
   assert.equal(facts.actualMain,true);api=await import(require('node:url').pathToFileURL(options.bundle).href);
   realm=api.createMainDshBootstrapAuthority();core=api.prepareOriginalMainDshCoreInfrastructure(realm);await api.startOriginalMainDshCoreInfrastructure(core);
   assert.notEqual(api.readOriginalMainDshAdmissionDatabase(realm),null);
   const before=await api.readOriginalMainDshRootNmpLedger(core);assert.equal(before.schemaVersion,4);assert.equal(before.tables.length,10);assert.equal(before.sourceKind,'live-session');assert.equal(before.sourceIdentity.kind,'protected-anchor-birth-audit-v2');
   const golden=path.join(options.root,'root-ledger-golden.json');
   if(fs.existsSync(golden)){const old=JSON.parse(fs.readFileSync(golden,'utf8'));assert.deepEqual(before,old);facts.coldEntireLedgerUnchanged=true;}
   budget=await api.createHarnessOptimizationRuntime({dataRoot:path.join(options.root,'budget'),profileId:'fixture-profile',workspaceId:'fixture-workspace',authorizeUser:()=>false,manifestLookup:()=>undefined,originalCoreLease:core});
   assert.equal((await budget.api.read()).status,'ready');
   store=new api.DesktopMultiAgentStore(path.join(options.root,'groups.sqlite'),{dshAdmissionSource:realm,dshUserControlSource:null});realm.bindStore(store);
   lease=api.prepareOriginalMainDshInstalledRootPool(realm,store);assert.equal(lease,core);const session=await api.openOriginalMainDshInstalledRootPool(lease),root=api.loadOriginalMainResourceAuthority();
   facts.phase=await api.readOriginalMainDshCoreBootstrap(lease,session);
   facts.originalSql=require(options.fragment).runProtectedNmpSqlFixture(root,session,facts.phase,options.root);
   const policy=root.readPolicy(session),physical=bytes(),one=await api.readOriginalMainDshRootNmpLedger(core),two=await api.readOriginalMainDshRootNmpLedger(core);
   assert.deepEqual(two,one);assert.deepEqual(bytes(),physical);assert.deepEqual(root.readPolicy(session),policy);assert.equal(one.poolId,before.poolId);assert.equal(one.tables.length,10);
   facts.counts=counts(one);assert.equal(facts.counts.nHeld,facts.phase==='fresh'?4:5);assert.equal(facts.counts.mHeld,facts.phase==='fresh'?2:4);assert.equal(facts.counts.pHeld,2);assert.ok(facts.counts.intents>=2);assert.ok(facts.counts.nReceipts>0);assert.ok(facts.counts.pReceipts>0);
   fs.writeFileSync(golden,JSON.stringify(one));facts.poolId=one.poolId;facts.fullLedgerSha256=hash(JSON.stringify(one));facts.databaseSha256=hash(physical);facts.bytesUnchanged=true;
   // Accepted history has no business effect permission and survives Source
   // positive revoke. The same original negative lifecycle is still required.
   realm.seal();assert.deepEqual(await api.readOriginalMainDshRootNmpLedger(core),one);assert.deepEqual(bytes(),physical);facts.readAfterSourceSeal=true;
  }catch(raw){first={raw};facts.first=hold(raw);}
  if(api&&lease)try{await api.returnOriginalMainDshInstalledRootPool(lease);facts.ownerReturned=true;}catch(raw){secondary.push(raw);facts.ownerClose=hold(raw);}
  if(budget)try{await budget.dispose();facts.budgetClosed=true;}catch(raw){secondary.push(raw);facts.budgetClose=hold(raw);}
  if(store)try{store.close();facts.storeClosed=true;}catch(raw){secondary.push(raw);facts.storeClose=hold(raw);}
  if(api&&core)try{await api.closeOriginalMainDshCoreInfrastructure(core);facts.coreClosed=true;}catch(raw){secondary.push(raw);facts.coreClose=hold(raw);}
  if(realm)try{realm.seal();}catch(raw){secondary.push(raw);hold(raw);}
  facts.homeEnvironmentUnchanged=process.env.HOME===originalHomeEnv;facts.nativeIdentityPreserved=nativeUserInfo().uid===nativeIdentity.uid&&nativeUserInfo().gid===nativeIdentity.gid;
  facts.windows=BrowserWindow.getAllWindows().length;facts.dockVisible=app.dock.isVisible();facts.failed=first!==undefined||secondary.length!==0;facts.secondaryCount=secondary.length;
  fs.writeFileSync(path.join(options.root,'ledger-main-'+process.pid+'.json'),JSON.stringify(facts,null,2));process.stdout.write(JSON.stringify(facts)+'\n');
  if(facts.failed){app.exit(1);return;}
  process.stdout.write(JSON.stringify({kind:'root-ledger-main-ready',pid:process.pid,execPath:process.execPath})+'\n');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{input+=chunk;if(input==='STOP\n'){process.stdin.pause();app.exit(0);}});
 }).catch(raw=>{hold(raw);process.stderr.write(JSON.stringify(hold(raw))+'\n');app.exit(1);});
};

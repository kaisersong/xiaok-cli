'use strict';
module.exports=function coreKSwarmFixture(options){
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{syncBuiltinESMExports}=require('node:module');
 const homeEnvironment={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE},originalAccount=os.userInfo();
 process.env.XIAOK_CONFIG_DIR=path.join(options.root,'config');
 const accountHome=path.join(options.root,'account');fs.mkdirSync(accountHome,{mode:0o700});
 const originalUserInfo=os.userInfo,originalHomedir=os.homedir;
 os.userInfo=options=>{const value=Reflect.apply(originalUserInfo,os,[options]);return {...value,homedir:Buffer.isBuffer(value.homedir)?Buffer.from(accountHome):accountHome};};os.homedir=()=>accountHome;syncBuiltinESMExports();
 const {app,BrowserWindow}=require('electron');app.setPath('userData',path.join(options.root,'userData'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
 const held=[];globalThis.originalCoreKSwarmFailures=held;
 const describe=raw=>{held.push({raw});const result={kind:typeof raw};if(raw&&typeof raw==='object'&&!require('node:util').types.isProxy(raw))for(const name of ['message','code','stack']){const d=Object.getOwnPropertyDescriptor(raw,name);if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string')result[name]=d.value;}return result;};
 app.whenReady().then(async()=>{
  const facts={kind:'original-core-kswarm-main',pid:process.pid,actualMain:process.type==='browser',productionQualified:false,launches:0};let api,core,realm,first,native,originalPortAssertion;const secondary=[],originalMethods=[];let replacedCalls=0;
  try{
   assert.equal(facts.actualMain,true);api=await import(require('node:url').pathToFileURL(options.bundle).href);realm=api.createMainDshBootstrapAuthority();core=api.prepareOriginalMainDshCoreInfrastructure(realm);await api.startOriginalMainDshCoreInfrastructure(core);
   native=require(options.standalone);originalPortAssertion=native.assertOriginalKSwarmChildPort;
   for(const name of ['prepareOriginalKSwarmChild','assertOriginalKSwarmChildPort','assertOriginalKSwarmChildTerminal']){const descriptor=Object.getOwnPropertyDescriptor(native,name);assert.ok(descriptor&&Object.hasOwn(descriptor,'value'));originalMethods.push({name,descriptor});Object.defineProperty(native,name,{...descriptor,value(){replacedCalls++;throw Error('public Native export replacement must not run');}});}
   const opening=api.prepareOriginalMainDshKSwarmChild(core);assert.equal(api.prepareOriginalMainDshKSwarmChild(core),opening);const port=await opening;
   Reflect.apply(originalPortAssertion,native,[port]);facts.sameOriginalPort=(await api.prepareOriginalMainDshKSwarmChild(core))===port;assert.equal(facts.sameOriginalPort,true);const terminal=originalMethods.find(row=>row.name==='assertOriginalKSwarmChildTerminal').descriptor.value;assert.throws(()=>Reflect.apply(terminal,native,[port]));facts.activeTerminalDenied=true;
   let traps=0;const proxy=new Proxy(core,{get(){traps++;throw 0;},ownKeys(){traps++;throw 0;},getOwnPropertyDescriptor(){traps++;throw 0;}});await assert.rejects(api.prepareOriginalMainDshKSwarmChild(proxy));assert.equal(traps,0);facts.foreignLeaseTraps=traps;
   facts.windows=BrowserWindow.getAllWindows().length;facts.dockVisible=app.dock.isVisible();assert.equal(facts.windows,0);assert.equal(facts.dockVisible,false);
   process.stdout.write(JSON.stringify({kind:'core-kswarm-main-ready',pid:process.pid,execPath:process.execPath,dockVisible:facts.dockVisible,windows:facts.windows})+'\n');
   await new Promise(resolve=>{let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',function stop(value){text+=value;if(text==='STOP\n'){process.stdin.removeListener('data',stop);process.stdin.pause();resolve();}});});
   await api.closeOriginalMainDshCoreInfrastructure(core);facts.coreClosed=true;
   // The public identity-only assertion remains a check of the same actual row;
   // terminal consumption and installation closure occurred inside original Core.
   Reflect.apply(originalPortAssertion,native,[port]);facts.sameOriginalPortAfterClose=true;facts.publicNativeReplacementCalls=replacedCalls;assert.equal(replacedCalls,0);
  }catch(raw){first={raw};facts.first=describe(raw);}
  if(api&&core)try{await api.closeOriginalMainDshCoreInfrastructure(core);facts.coreClosed=true;}catch(raw){secondary.push({raw});facts.closeFailure=describe(raw);}
  if(realm)try{realm.seal();}catch(raw){secondary.push({raw});facts.sealFailure=describe(raw);}
  if(native)for(const row of originalMethods)try{Object.defineProperty(native,row.name,row.descriptor);}catch(raw){secondary.push({raw});facts.restoreFailure=describe(raw);}
  facts.homeEnvironmentUnchanged=process.env.HOME===homeEnvironment.HOME&&process.env.USERPROFILE===homeEnvironment.USERPROFILE;const account=os.userInfo();facts.nativeIdentityPreserved=account.uid===originalAccount.uid&&account.gid===originalAccount.gid&&account.username===originalAccount.username;
  os.userInfo=originalUserInfo;os.homedir=originalHomedir;syncBuiltinESMExports();facts.failed=first!==undefined||secondary.length!==0;facts.secondaryCount=secondary.length;
  fs.writeFileSync(path.join(options.root,'core-kswarm-main-facts.json'),JSON.stringify(facts,null,2)+'\n');process.stdout.write(JSON.stringify(facts)+'\n');app.exit(facts.failed?1:0);
 }).catch(raw=>{globalThis.originalCoreKSwarmUnhandled={raw};process.stderr.write(JSON.stringify({kind:'fixture-unhandled',failure:describe(raw)})+'\n');app.exit(1);});
};

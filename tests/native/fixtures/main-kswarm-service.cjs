'use strict';
// Called only by the reviewed fixed fixture entry after Root authorizes one Main.
module.exports=function runMainService(options){
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
 const {syncBuiltinESMExports}=require('node:module'),{pathToFileURL}=require('node:url');
 let app,BrowserWindow;
 try{
 ({app,BrowserWindow}=require('electron'));
 const home={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE},account=os.userInfo();
 process.env.XIAOK_CONFIG_DIR=path.join(options.root,'config');
 process.env.KSWARM_SERVER_PATH=path.join(options.kswarm,'src','server','index.js');
 process.env.KSWARM_DATA_ROOT=path.join(options.root,'kswarm-data');
 const privateHome=path.join(options.root,'account');
 try{fs.mkdirSync(privateHome,{mode:0o700});}catch(raw){const d=raw&&typeof raw==='object'&&!require('node:util').types.isProxy(raw)?Object.getOwnPropertyDescriptor(raw,'code'):undefined;if(!d||!Object.hasOwn(d,'value')||d.value!=='EEXIST')throw raw;}
 const privateStat=fs.lstatSync(privateHome),canonicalRoot=fs.realpathSync(options.root);
 if(privateStat.isSymbolicLink()||!privateStat.isDirectory()||privateStat.uid!==process.getuid()||(privateStat.mode&0o7777)!==0o700||canonicalRoot!==path.resolve(options.root)||fs.realpathSync(privateHome)!==path.join(canonicalRoot,'account')||fs.readdirSync(privateHome).length!==0)throw Error('MAIN_SERVICE_FIXTURE_PRIVATE_ACCOUNT_REQUIRED');
 const userInfo=os.userInfo,homedir=os.homedir;
 os.userInfo=input=>{const row=Reflect.apply(userInfo,os,[input]);return {...row,homedir:Buffer.isBuffer(row.homedir)?Buffer.from(privateHome):privateHome};};os.homedir=()=>privateHome;syncBuiltinESMExports();
 app.setPath('userData',path.join(options.root,'userData'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
 const retained=[];globalThis.originalMainKSwarmServiceFailures=retained;
 const describe=raw=>{retained.push({raw});const seen=new Set();function graph(value,depth=0){const out={kind:typeof value};if(value===undefined){out.undefined=true;return out;}if(value===null){out.null=true;return out;}if(typeof value!=='object'){if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')out.value=value;return out;}if(require('node:util').types.isProxy(value)){out.proxy=true;return out;}if(seen.has(value)){out.circular=true;return out;}seen.add(value);if(depth>5){out.truncated=true;return out;}out.own=[];for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);out.own.push({key:typeof key==='symbol'?String(key):key,...(d&&Object.hasOwn(d,'value')?{value:graph(d.value,depth+1)}:{accessor:true})});}return out;}return graph(raw);};
 app.whenReady().then(async()=>{
  const facts={kind:'original-main-kswarm-service',pid:process.pid,actualMain:process.type==='browser',productionQualified:false,phases:[]};let api,source,user,service,services,port,native,first;const secondaries=[];
  const save=()=>fs.writeFileSync(path.join(options.root,'main-service-facts.json'),JSON.stringify(facts,null,2)+'\n');
  const attempt=async(label,fn)=>{try{await fn();facts.phases.push(label);}catch(raw){first??={raw};secondaries.push({label,raw});facts[label+'Failure']=describe(raw);}};
  try{
   assert.equal(facts.actualMain,true);api=await import(pathToFileURL(options.bundle).href);
   const dataRoot=path.join(options.root,'desktop'),workspaceRoot=path.join(options.root,'workspace');fs.mkdirSync(workspaceRoot,{mode:0o700});
   const scope=api.resolveDesktopServiceScope({dataRoot,workspaceRoot});
   const windowOwner=new api.DesktopApplicationWindowOwner({current:()=>null,async bootstrap(){throw Error('fixture must not open a view');},async createView(){throw Error('fixture must not open a view');}});
   user=api.createMainDshControlSource({windowOwner,scope:{profileId:scope.profileId,workspaceId:scope.workspaceId},isTrustedUrl:()=>false});
   source=api.createOriginalMainDshServiceSources({scope:{profileId:scope.profileId,workspaceId:scope.workspaceId},userSource:user});
   const actor=Object.freeze({requestSource:'user',principalId:'desktop-main-window'});
   await api.prepareOriginalMainDshServiceSources(source,{dataRoot,workspaceRoot,harnessUserActor:actor});facts.phases.push('sources-prepared');
   const prepared=api.readOriginalMainDshPreparedSources(source);
   service=api.createKSwarmService({desktopProjectScope:prepared.scope,ownedDshAdmission:prepared.businessSource.admission});
   services=api.createDesktopServices({dataRoot,workspaceRoot,kswarmService:service,harnessOptimizationUserActor:actor,dshServiceSources:source,modelProbeUserSource:user,materialUserSource:user,knowledgeDbPath:path.join(options.root,'knowledge.sqlite')});
   const binding=api.readOriginalMainDshServicesBinding(services,source);await binding.constructionReady;facts.phases.push('construction-ready');assert.equal(binding.kswarmService,service);assert.equal(binding.lease,prepared);
   await api.bindOriginalMainDshKSwarmService(services,source);facts.phases.push('service-bound');
   const core=api.readOriginalMainDshStartedCore(prepared.realm,binding.store);assert.ok(core);
   port=await api.prepareOriginalMainDshKSwarmChild(core);assert.equal(await api.prepareOriginalMainDshKSwarmChild(core),port);
   native=require(options.standalone);assert.throws(()=>native.assertOriginalKSwarmChildTerminal(port));facts.unenteredTerminalDenied=true;
   await service.start();const status=service.getStatus();assert.equal(status.running,true);assert.equal(status.port,options.kswarmPort);assert.ok(status.pid>0&&status.pid!==process.pid);facts.childPid=status.pid;facts.launches=1;
   assert.throws(()=>native.assertOriginalKSwarmChildTerminal(port));facts.activeTerminalDenied=true;
   facts.windows=BrowserWindow.getAllWindows().length;facts.dockVisible=app.dock.isVisible();assert.equal(facts.windows,0);assert.equal(facts.dockVisible,false);facts.phases.push('actual-service-launched');save();
   process.stdout.write(JSON.stringify({kind:'main-kswarm-service-ready',pid:process.pid,childPid:status.pid,execPath:process.execPath,windows:facts.windows,dockVisible:facts.dockVisible})+'\n');
   await new Promise(resolve=>{let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',function stop(raw){text+=raw;if(text==='STOP\n'){process.stdin.removeListener('data',stop);process.stdin.pause();resolve();}});});
  }catch(raw){first={raw};facts.first=describe(raw);}
  if(service&&api)await attempt('service-sealed-drained',()=>api.sealAndDrainKSwarmServiceInstance(service));
  if(port&&api){await attempt('source-physical',async()=>{const child=api.readOptionalOriginalProtectedKSwarmChildPortFate(port),bound=api.readOptionalOriginalProtectedKSwarmServicePortFate(port);assert.ok(child&&bound);await child.waitPhysicalKnown();child.assertPhysicalKnown();await bound.waitPhysicalKnown();bound.assertPhysicalKnown();});await attempt('native-terminal',()=>native.assertOriginalKSwarmChildTerminal(port));}
  if(services)await attempt('services-core-closed',async()=>{const result=await services.disposeMultiAgent();assert.equal(result.drained,true);});
  else if(source&&api)await attempt('startup-closed',()=>api.closeOriginalMainDshStartupSources(source));
  if(user)await attempt('user-source-closed',async()=>{user.seal();await user.drain();});
  facts.homeUnchanged=process.env.HOME===home.HOME&&process.env.USERPROFILE===home.USERPROFILE;const actual=os.userInfo();facts.nativeAccountUnchanged=actual.uid===account.uid&&actual.gid===account.gid&&actual.username===account.username;
  os.userInfo=userInfo;os.homedir=homedir;syncBuiltinESMExports();facts.failed=first!==undefined;facts.secondaryCount=secondaries.length;save();process.stdout.write(JSON.stringify(facts)+'\n');app.exit(facts.failed?1:0);
 }).catch(raw=>{retained.push({raw});process.stderr.write(JSON.stringify({kind:'main-service-unhandled',failure:describe(raw)})+'\n');app.exit(1);});
 }catch(raw){
  globalThis.originalMainServiceSetupFailure={raw};
  const shape={kind:typeof raw};if(raw&&typeof raw==='object'&&!require('node:util').types.isProxy(raw)){const d=Object.getOwnPropertyDescriptor(raw,'message');if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string')shape.message=d.value;}
  const facts={kind:'original-main-kswarm-service',pid:process.pid,failed:true,fixtureSetupFailed:true,phases:[],first:shape,physicalFateAsserted:false};
  try{fs.writeFileSync(path.join(options.root,'main-service-setup-failure-attempt003.json'),JSON.stringify(facts,null,2)+'\n');}catch(secondary){globalThis.originalMainServiceSetupFailure.secondary=secondary;}
  try{fs.writeSync(2,JSON.stringify(facts)+'\n');}catch(secondary){globalThis.originalMainServiceSetupFailure.stderrFailure=secondary;}
  if(app&&typeof app.exit==='function')app.exit(1);else process.exit(1);
 }
};

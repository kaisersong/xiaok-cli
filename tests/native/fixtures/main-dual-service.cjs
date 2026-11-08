'use strict';
// Called only by the reviewed fixed fixture entry after Root authorizes one Main.
module.exports=function runMainDualService(options){
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
 const {syncBuiltinESMExports}=require('node:module'),{pathToFileURL}=require('node:url');
 let app,BrowserWindow;
 try{
 ({app,BrowserWindow}=require('electron'));
 const home={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE},account=os.userInfo();
 process.env.XIAOK_CONFIG_DIR=path.join(options.root,'config');
 process.env.KSWARM_SERVER_PATH=path.join(options.kswarm,'src','server','index.js');
 process.env.KSWARM_DATA_ROOT=path.join(options.root,'kswarm-data');
 process.env.INTENT_BROKER_SERVER_PATH=path.join(options.broker,'src','cli.js');
 const privateHome=path.join(options.root,'account');
 try{fs.mkdirSync(privateHome,{mode:0o700});}catch(raw){const d=raw&&typeof raw==='object'&&!require('node:util').types.isProxy(raw)?Object.getOwnPropertyDescriptor(raw,'code'):undefined;if(!d||!Object.hasOwn(d,'value')||d.value!=='EEXIST')throw raw;}
 const privateStat=fs.lstatSync(privateHome),canonicalRoot=fs.realpathSync(options.root);
 if(privateStat.isSymbolicLink()||!privateStat.isDirectory()||privateStat.uid!==process.getuid()||(privateStat.mode&0o7777)!==0o700||canonicalRoot!==path.resolve(options.root)||fs.realpathSync(privateHome)!==path.join(canonicalRoot,'account')||fs.readdirSync(privateHome).length!==0)throw Error('MAIN_SERVICE_FIXTURE_PRIVATE_ACCOUNT_REQUIRED');
 const userInfo=os.userInfo,homedir=os.homedir;
 os.userInfo=input=>{const row=Reflect.apply(userInfo,os,[input]);return {...row,homedir:Buffer.isBuffer(row.homedir)?Buffer.from(privateHome):privateHome};};os.homedir=()=>privateHome;syncBuiltinESMExports();
 app.setPath('userData',path.join(options.root,'userData'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
 const retained=[];globalThis.originalMainDualServiceFailures=retained;
 const describe=raw=>{retained.push({raw});const seen=new Set();function graph(value,depth=0){const out={kind:typeof value};if(value===undefined){out.undefined=true;return out;}if(value===null){out.null=true;return out;}if(typeof value!=='object'){if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')out.value=value;return out;}if(require('node:util').types.isProxy(value)){out.proxy=true;return out;}if(seen.has(value)){out.circular=true;return out;}seen.add(value);if(depth>5){out.truncated=true;return out;}out.own=[];for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);out.own.push({key:typeof key==='symbol'?String(key):key,...(d&&Object.hasOwn(d,'value')?{value:graph(d.value,depth+1)}:{accessor:true})});}return out;}return graph(raw);};
 app.whenReady().then(async()=>{
  const facts={kind:'original-main-dual-service',pid:process.pid,actualMain:process.type==='browser',productionQualified:false,phases:[]};let api,source,user,service,services,port,brokerPort,native,first;const secondaries=[];
  const save=()=>fs.writeFileSync(path.join(options.root,'main-dual-service-facts.json'),JSON.stringify(facts,null,2)+'\n');
  const attempt=async(label,fn)=>{try{await fn();facts.phases.push(label);}catch(raw){first??={raw};secondaries.push({label,raw});facts[label+'Failure']=describe(raw);}};
  try{
   assert.equal(facts.actualMain,true);api=await import(pathToFileURL(options.bundle).href);assert.equal(fs.realpathSync(api.getConfigDir()),fs.realpathSync(path.join(options.root,'config')));facts.privateConfigConfirmed=true;
   const dataRoot=path.join(options.root,'desktop'),workspaceRoot=path.join(options.root,'workspace');
   try{fs.mkdirSync(workspaceRoot,{mode:0o700});}catch(raw){const d=raw&&typeof raw==='object'&&!require('node:util').types.isProxy(raw)?Object.getOwnPropertyDescriptor(raw,'code'):undefined;if(!d||!Object.hasOwn(d,'value')||d.value!=='EEXIST')throw raw;}
   const workspaceStat=fs.lstatSync(workspaceRoot),canonicalWorkspaceRoot=fs.realpathSync(options.root);
   if(workspaceStat.isSymbolicLink()||!workspaceStat.isDirectory()||workspaceStat.uid!==process.getuid()||(workspaceStat.mode&0o7777)!==0o700||canonicalWorkspaceRoot!==path.resolve(options.root)||fs.realpathSync(workspaceRoot)!==path.join(canonicalWorkspaceRoot,'workspace')||fs.readdirSync(workspaceRoot).length!==0)throw Error('MAIN_SERVICE_FIXTURE_PRIVATE_WORKSPACE_REQUIRED');
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
   await api.bindOriginalMainDshKSwarmService(services,source);await api.bindOriginalMainDshBrokerService(services,source);facts.phases.push('dual-service-bound');
   port=await api.prepareOriginalMainDshSourceKSwarmChild(source,prepared);brokerPort=await api.prepareOriginalMainDshSourceBrokerChild(source,prepared);assert.notEqual(port,brokerPort);
   assert.equal(await api.prepareOriginalMainDshSourceKSwarmChild(source,prepared),port);assert.equal(await api.prepareOriginalMainDshSourceBrokerChild(source,prepared),brokerPort);
   native=require(options.standalone);assert.throws(()=>native.assertOriginalKSwarmChildTerminal(port));assert.throws(()=>native.assertOriginalBrokerChildTerminal(brokerPort));facts.unenteredTerminalsDenied=true;
   await service.start();const status=service.getStatus();assert.equal(status.running,true);assert.equal(status.port,options.kswarmPort);assert.ok(status.pid>0&&status.pid!==process.pid);facts.childPid=status.pid;facts.launches=1;
   assert.throws(()=>native.assertOriginalKSwarmChildTerminal(port));assert.throws(()=>native.assertOriginalBrokerChildTerminal(brokerPort));facts.activeTerminalsDenied=true;
   let snapshot;for(;;){snapshot=await service.getServiceStatus();const ks=snapshot.services.find(s=>s.id==='kswarm');if(ks?.detail==='broker connected')break;await new Promise(resolve=>setTimeout(resolve,50));}
   const ks=snapshot.services.find(s=>s.id==='kswarm'),br=snapshot.services.find(s=>s.id==='intent-broker');assert.ok(ks?.running&&ks.reachable&&br?.running&&br.reachable);assert.equal(ks.port,options.kswarmPort);assert.equal(br.port,options.brokerPort);assert.equal(ks.pid,status.pid);assert.ok(Number.isSafeInteger(br.pid)&&br.pid>0&&br.pid!==process.pid&&br.pid!==ks.pid);facts.childPids={kswarm:ks.pid,broker:br.pid};facts.launches=2;facts.brokerConnected=true;facts.phases.push('dual-service-connected');
   const secretFile=path.join(options.root,'userData','room-auth-secrets.json'),secretStat=fs.lstatSync(secretFile);assert.ok(secretStat.isFile()&&!secretStat.isSymbolicLink()&&secretStat.uid===process.getuid()&&(secretStat.mode&0o7777)===0o600);const secrets=JSON.parse(fs.readFileSync(secretFile,'utf8'));
   for(const key of ['desktopRoomToken','kswarmRoomToken'])assert.ok(typeof secrets[key]==='string'&&secrets[key].length>0&&secrets[key].length<=4096&&!secrets[key].includes('\0'),'original private room credential required');assert.ok(secrets.desktopRoomToken!==secrets.kswarmRoomToken,'separate original room credentials required');
   const {readRoomProtocol}=require('./main-dual-service-http.cjs'),desktop=await readRoomProtocol(options.brokerPort,secrets.desktopRoomToken),system=await readRoomProtocol(options.brokerPort,secrets.kswarmRoomToken),absent=await readRoomProtocol(options.brokerPort),forbidden=await readRoomProtocol(options.brokerPort,secrets.kswarmRoomToken,'/room-wakes?logicalAgentId=fixture-observer');
   for(const reply of [desktop,system]){assert.equal(reply.status,200);assert.equal(reply.body.ok,true);assert.ok(reply.body.protocols.room_workspace_v1);}assert.equal(absent.status,401);assert.equal(forbidden.status,403);facts.roomAuthentication={desktopStatus:desktop.status,kswarmStatus:system.status,absentStatus:absent.status,kswarmDesktopOnlyStatus:forbidden.status,allBodiesComplete:true,allSocketsClosed:true};facts.phases.push('room-authenticated');
   facts.windows=BrowserWindow.getAllWindows().length;facts.dockVisible=app.dock.isVisible();assert.equal(facts.windows,0);assert.equal(facts.dockVisible,false);facts.phases.push('actual-service-launched');save();
   process.stdout.write(JSON.stringify({kind:'main-dual-service-ready',pid:process.pid,childPid:status.pid,childPids:facts.childPids,execPath:process.execPath,windows:facts.windows,dockVisible:facts.dockVisible})+'\n');
   await new Promise(resolve=>{let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',function stop(raw){text+=raw;if(text==='STOP\n'){process.stdin.removeListener('data',stop);process.stdin.pause();resolve();}});});
  }catch(raw){first={raw};facts.first=describe(raw);}
  if(service&&api)await attempt('service-sealed-drained',()=>api.sealAndDrainKSwarmServiceInstance(service));
  if(api){const joins=[];if(port)joins.push(attempt('ks-source-physical',async()=>{const child=api.readOptionalOriginalProtectedKSwarmChildPortFate(port),bound=api.readOptionalOriginalProtectedKSwarmServicePortFate(port);assert.ok(child&&bound);await child.waitPhysicalKnown();child.assertPhysicalKnown();await bound.waitPhysicalKnown();bound.assertPhysicalKnown();}));if(brokerPort)joins.push(attempt('broker-source-physical',async()=>{const child=api.readOptionalOriginalProtectedBrokerChildPortFate(brokerPort),bound=api.readOptionalOriginalProtectedBrokerServicePortFate(brokerPort);assert.ok(child&&bound);await child.waitPhysicalKnown();child.assertPhysicalKnown();await bound.waitPhysicalKnown();bound.assertPhysicalKnown();}));await Promise.all(joins);if(port)await attempt('ks-native-terminal',()=>native.assertOriginalKSwarmChildTerminal(port));if(brokerPort)await attempt('broker-native-terminal',()=>native.assertOriginalBrokerChildTerminal(brokerPort));}
  if(services)await attempt('services-core-closed',async()=>{const result=await services.disposeMultiAgent();assert.equal(result.drained,true);});
  else if(source&&api)await attempt('startup-closed',()=>api.closeOriginalMainDshStartupSources(source));
  if(user)await attempt('user-source-closed',async()=>{user.seal();await user.drain();});
  facts.homeUnchanged=process.env.HOME===home.HOME&&process.env.USERPROFILE===home.USERPROFILE;const actual=os.userInfo();facts.nativeAccountUnchanged=actual.uid===account.uid&&actual.gid===account.gid&&actual.username===account.username;
  os.userInfo=userInfo;os.homedir=homedir;syncBuiltinESMExports();facts.failed=first!==undefined;facts.secondaryCount=secondaries.length;save();process.stdout.write(JSON.stringify(facts)+'\n');app.exit(facts.failed?1:0);
 }).catch(raw=>{retained.push({raw});process.stderr.write(JSON.stringify({kind:'main-service-unhandled',failure:describe(raw)})+'\n');app.exit(1);});
 }catch(raw){
  globalThis.originalMainServiceSetupFailure={raw};
  const shape={kind:typeof raw};if(raw&&typeof raw==='object'&&!require('node:util').types.isProxy(raw)){const d=Object.getOwnPropertyDescriptor(raw,'message');if(d&&Object.hasOwn(d,'value')&&typeof d.value==='string')shape.message=d.value;}
  const facts={kind:'original-main-dual-service',pid:process.pid,failed:true,fixtureSetupFailed:true,phases:[],first:shape,physicalFateAsserted:false};
  try{fs.writeFileSync(path.join(options.root,'main-dual-service-setup-failure.json'),JSON.stringify(facts,null,2)+'\n');}catch(secondary){globalThis.originalMainServiceSetupFailure.secondary=secondary;}
  try{fs.writeSync(2,JSON.stringify(facts)+'\n');}catch(secondary){globalThis.originalMainServiceSetupFailure.stderrFailure=secondary;}
  if(app&&typeof app.exit==='function')app.exit(1);else process.exit(1);
 }
};

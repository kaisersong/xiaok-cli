import {app,BrowserWindow,ipcMain} from 'electron';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import fs,{writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
const root=process.env.XIAOK_DSH_A6_NATIVE_ROOT,compiled=process.env.XIAOK_DSH_A6_NATIVE_COMPILED;
if(!root||!compiled)throw Error('isolated_fixture_paths_required');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const bundle=process.env.XIAOK_DSH_A6_NATIVE_BUNDLE;
  const storeApi=await import(pathToFileURL(bundle||join(compiled,'desktop-multi-agent-store.js')).href);
  const {createMainDshControlSource}=bundle?storeApi:await import(pathToFileURL(join(compiled,'main-dsh-control-source.js')).href);
  const {createMainDshBootstrapAuthority}=bundle?storeApi:await import(pathToFileURL(join(compiled,'main-dsh-bootstrap-authority.js')).href);
  const realm=createMainDshBootstrapAuthority(),scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
  const html=join(root,'index.html'),preload=join(root,'preload.cjs');
  writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('a6',action=>ipcRenderer.invoke('fixture:a6',action));\n");
  writeFileSync(html,'<!doctype html><body>'+['enroll','setup','observe','read','pure','off','probe'].map(id=>`<button id="${id}">${id}</button>`).join('')+'<output id="result"></output><script>for(const button of document.querySelectorAll("button"))button.onclick=async()=>{try{document.querySelector("output").textContent=JSON.stringify(await window.a6(button.id));}catch(e){document.querySelector("output").textContent=JSON.stringify({error:String(e)});}}</script>');
  const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const user=createMainDshControlSource({window,scope,isTrustedUrl:url=>url.startsWith('file:')&&fileURLToPath(url)===html});
  const store=new storeApi.DesktopMultiAgentStore(join(root,'groups.sqlite'),{dshAdmissionSource:realm,dshUserControlSource:user});
  realm.bindStore(store);user.bindStore(store);store.claimBootOwnership();
  const port=storeApi.readOriginalDshAdmissionPort(store,realm);
  port.initialize(realm.openBootstrap('initialize'),{requestSource:'user'});
  port.upgradeAdmission(realm.openBootstrap('migrate_admission'),{requestSource:'user'});
  const setup={schemaVersion:1,setupId:'explicit-native-setup',tenantId:'tenant',candidateRepository:{owner:'owner',repo:'repo'},mode:'observe',accountId:'setup-account-intent-only',minimumIntervalMs:1000,selection:{kind:'issue_ids',issueIds:['42']},issueRefs:[{issueId:'42',issueNumber:1}]};
  const setupBody={control:{kind:'source_setup',setup},expectedRevision:0};
  let held,view;
  function invoke(event,purpose,body,action){const frame=user.open(event,purpose,body,'user');try{return action(frame,{requestSource:'user',bodyHash:frame.bodyHash,bootstrapAuthority:realm});}finally{frame.release();}}
  ipcMain.handle('fixture:a6',(event,action)=>{
    if(action==='enroll')return invoke(event,'enroll_authority',{schemaVersion:1,expectedDomainRevision:0,ownerDomainIds:[]},(frame,context)=>port.enrollAuthority(frame.proof,context));
    if(action==='setup')return invoke(event,'policy_control',setupBody,(frame,context)=>port.applyControl(frame.proof,context));
    if(action==='observe'){
      const identities=[{kind:'global'},{kind:'tenant',tenantId:'tenant'},{kind:'workspace',tenantId:'tenant',workspaceId:scope.workspaceId}];
      for(const identity of identities)invoke(event,'policy_control',{control:{kind:'mode',identity,mode:'observe',epoch:1},expectedRevision:0},(frame,context)=>port.applyControl(frame.proof,context));
      return{explicitModePrefixes:3};
    }
    if(action==='read'){
      held?.release();held=user.open(event,'policy_control',setupBody,'user');
      const proof=realm.openGithubSourceSetup({setupId:setup.setupId,bodyHash:held.bodyHash,candidateRepository:setup.candidateRepository,expectedConfigurationRevision:1},{userControlProof:held.proof});
      try{view=storeApi.readOriginalDshGithubReadAuthority(realm,store,realm,proof,'source_setup');view.assertCurrent();view.assertLocal();return{kind:view.kind,prefixes:view.guardRevisions.length,mode:view.mode,noFakeBinding:!('sourceBindingId'in view)&&!('providerAccountId'in view),current:true,noHttpIssued:true};}
      catch(error){held.release();held=undefined;return{failure:error.message,noHttpIssued:true};}
    }
    if(action==='pure'){assert.ok(view);const native=fs.lstatSync;let calls=0;fs.lstatSync=function(...args){calls++;return Reflect.apply(native,fs,args);};syncBuiltinESMExports();try{view.assertLocal();}finally{fs.lstatSync=native;syncBuiltinESMExports();}return{filesystemCalls:calls};}
    if(action==='off')return invoke(event,'policy_control',{control:{kind:'mode',identity:{kind:'global'},mode:'off',epoch:2},expectedRevision:1},(frame,context)=>port.applyControl(frame.proof,context));
    if(action==='probe'){assert.ok(view);assert.throws(()=>view.assertLocal(),/STALE|AUTHORITY/);assert.throws(()=>view.assertCurrent());return{oldLocalRejected:true,oldCurrentRejected:true};}
    throw Error('FIXTURE_ACTION_DENIED');
  });
  globalThis.dshA6Native={ready:false,close:async()=>{held?.release();user.seal();await user.drain();realm.seal();await port.waitKnown();store.close();ipcMain.removeHandler('fixture:a6');window.destroy();return{sourceKnown:true,storeClosed:true,notNativeNQualification:true};}};
  await window.loadFile(html);globalThis.dshA6Native.ready=true;
}).catch(error=>{globalThis.dshA6Native={ready:true,error:String(error),stack:error.stack};console.error(error);});

import {app,BrowserWindow,ipcMain} from 'electron';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=process.env.XIAOK_DSH_BUDGET_NATIVE_ROOT;
if(!root)throw Error('ISOLATED_BUDGET_NATIVE_ROOT_REQUIRED');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
    const base=pathToFileURL(resolve('dist/main/desktop/electron')+'/');
    const bootstrap=await import(new URL('main-dsh-bootstrap-authority.js',base)),userModule=await import(new URL('main-dsh-control-source.js',base)),budgetModule=await import(new URL('main-dsh-budget-authority-source.js',base)),runtimeModule=await import(new URL('harness-optimization-service.js',base)),storeModule=await import(new URL('desktop-multi-agent-store.js',base));
    const realm=bootstrap.createMainDshBootstrapAuthority(),scope={profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)};
    const html=join(root,'index.html'),preload=join(root,'preload.cjs');
    writeFileSync(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('budget',{enroll:()=>ipcRenderer.invoke('fixture:budget-enroll'),configure:()=>ipcRenderer.invoke('fixture:budget-config')});\n");
    writeFileSync(html,'<!doctype html><body><button id="enroll">Enable source</button><button id="budget">Configure budget</button><output id="enrollment"></output><output id="result"></output><script>document.querySelector("#enroll").onclick=async()=>{try{document.querySelector("#enrollment").textContent=JSON.stringify(await window.budget.enroll());}catch(e){document.querySelector("#enrollment").textContent=JSON.stringify({error:String(e)});}};document.querySelector("#budget").onclick=async()=>{try{document.querySelector("#result").textContent=JSON.stringify(await window.budget.configure());}catch(e){document.querySelector("#result").textContent=JSON.stringify({error:String(e)});}};</script>');
    const window=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    const user=userModule.createMainDshControlSource({window,scope,isTrustedUrl:url=>url.startsWith('file://')});
    const budgetSource=budgetModule.createMainDshBudgetAuthoritySource({realm,userSource:user});
    const runtime=await runtimeModule.createHarnessOptimizationRuntime({dataRoot:join(root,'budget'),...scope,authorizeUser:actor=>budgetModule.isOriginalMainDshBudgetActor(budgetSource,actor),manifestLookup:()=>undefined,dshBudgetAuthoritySource:budgetSource});
    const store=new storeModule.DesktopMultiAgentStore(join(root,'groups.sqlite'),{dshAdmissionSource:realm,dshUserControlSource:user,dshBudgetBinding:{runtime,exactConstructorSource:budgetSource}});
    realm.bindStore(store);user.bindStore(store);budgetSource.bindStore(store);store.claimBootOwnership();
    const port=storeModule.readOriginalDshAdmissionPort(store,realm),budgetPort=runtimeModule.readOriginalDshBudgetPort(runtime,budgetSource);
    assert.equal(port.initialize(realm.openBootstrap('initialize'),{requestSource:'user'}).ok,true);
    assert.equal(port.upgradeAdmission(realm.openBootstrap('migrate_admission'),{requestSource:'user'}).ok,true);
    const facts={nativeMain:true,actualUserIPC:0,accountOpened:false,budgetPinned:false,noModelCalls:true,noNativeNGrant:true};
    ipcMain.handle('fixture:budget-enroll',event=>{
        const frame=user.open(event,'enroll_authority',{schemaVersion:1,expectedDomainRevision:0,ownerDomainIds:[]},'user');
        try{const value=port.enrollAuthority(frame.proof,{requestSource:'user',bodyHash:frame.bodyHash,bootstrapAuthority:realm});facts.actualUserIPC++;return value;}finally{frame.release();}
    });
    const account={accountId:'main-account',tokenLimit:10000,costLimitMicros:250000,currency:'USD',scale:6,validUntil:Date.now()+600000};
    ipcMain.handle('fixture:budget-config',async event=>{
        const frame=user.open(event,'policy_control',{schemaVersion:1,kind:'budget_config',account,mandate:{tenantId:'user-selected-tenant',mandateId:'user-selected-mandate',mandateRevision:1}},'user');
        try {
            const request=budgetSource.openUserBudget(frame.proof,frame.bodyHash);
            await runtime.dsh.openAccount(request.account,request.openProof);facts.accountOpened=true;
            const observation=await budgetPort.observe(request.readInput,request.readProof),view=runtimeModule.readOriginalDshBudgetObservation(budgetPort,observation);
            const pinned=port.pinBudget(observation,{requestSource:'scheduler',bootstrapAuthority:realm});assert.equal(pinned.ok,true);facts.budgetPinned=true;facts.actualUserIPC++;
            const actual=storeModule.readOriginalDshDomainMetadata(realm,store,realm,scope);
            assert.equal(actual.budget.ownerId,view.ownerId);assert.equal(actual.budget.accountId,'main-account');assert.equal(actual.budget.unitProfile,'dsh_budget_usd_micros_v1');
            assert.equal(view.status.account.authority_hash,actual.budgetAuthorityHash);assert.equal(view.status.account.authorization_epoch,actual.authorityEpoch);
            return {ok:true,state:actual.state,budget:actual.budget,authorizationEpoch:actual.authorityEpoch,accountCurrency:view.status.account.currency,accountScale:view.status.account.scale,costLimitMicros:view.status.account.cost_limit,qualified:false};
        } finally{frame.release();}
    });
    await window.loadFile(html);
    globalThis.dshBudgetNative={ready:true,facts,async close(){budgetSource.seal();await budgetSource.drain();await runtime.dispose();realm.seal();await user.drain();store.close();ipcMain.removeHandler('fixture:budget-enroll');ipcMain.removeHandler('fixture:budget-config');window.destroy();return {runtimeClosed:true,storeClosed:true,sourceDrained:true,noNativeNGrant:true};}};
}).catch(error=>{globalThis.dshBudgetNative={ready:true,error:String(error),stack:error?.stack};console.error(error);});

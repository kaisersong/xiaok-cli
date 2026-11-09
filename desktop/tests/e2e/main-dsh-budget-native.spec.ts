import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('actual Main user IPC opens the original budget and pins its genuine account into original A',async()=>{
    const root=mkdtempSync(join(tmpdir(),'xiaok-dsh-budget-native-'));
    let application:Awaited<ReturnType<typeof electron.launch>>|undefined;
    try {
        application=await electron.launch({args:[resolve('tests/e2e/fixtures/main-dsh-budget-native.mjs'),'--user-data-dir='+join(root,'profile')],env:{...process.env,XIAOK_DSH_BUDGET_NATIVE_ROOT:root}});
        const child=application.process();let contextLosses=0;
        console.log(JSON.stringify({fixture:'main-dsh-budget-native',pid:child.pid,phase:'started'}));
        child.stderr?.on('data',value=>console.log(String(value)));
        await expect.poll(async()=>{try{return await application!.evaluate(()=>Boolean((globalThis as any).dshBudgetNative?.ready));}catch(error){if(!String(error).includes('Execution context was destroyed'))throw error;contextLosses++;return false;}},{timeout:15000}).toBe(true);
        expect(await application.evaluate(()=>(globalThis as any).dshBudgetNative.error)).toBeUndefined();
        const page=await application.firstWindow();await page.locator('#enroll').click();await expect(page.locator('#enrollment')).toContainText('pending_baseline');
        const enrollment=JSON.parse(await page.locator('#enrollment').innerText());expect(enrollment).toMatchObject({ok:true,qualified:false,enrollment:{authorityEpoch:1,state:'pending_baseline',budget:null}});
        await page.locator('#budget').click();await expect(page.locator('#result')).toContainText('"ok":true');
        const result=JSON.parse(await page.locator('#result').innerText());expect(result).toMatchObject({ok:true,state:'pending_baseline',accountCurrency:'USD',accountScale:6,costLimitMicros:250000,authorizationEpoch:1,qualified:false,budget:{accountId:'main-account',unitProfile:'dsh_budget_usd_micros_v1'}});
        const facts=await application.evaluate(()=>(globalThis as any).dshBudgetNative.facts);expect(facts).toMatchObject({nativeMain:true,actualUserIPC:2,accountOpened:true,budgetPinned:true,noModelCalls:true,noNativeNGrant:true});
        const closed=await application.evaluate(async()=>(globalThis as any).dshBudgetNative.close());expect(closed).toEqual({runtimeClosed:true,storeClosed:true,sourceDrained:true,noNativeNGrant:true});
        console.log('ACTUAL_MAIN_BUDGET_FACTS',JSON.stringify({pid:child.pid,enrollment,result,facts,closed,contextLosses}));
    } finally {
        if(application){const child=application.process();await application.close();expect(child.exitCode).toBe(0);console.log(JSON.stringify({fixture:'main-dsh-budget-native',pid:child.pid,exitCode:child.exitCode,reaped:true}));}
        rmSync(root,{recursive:true,force:true});
    }
});

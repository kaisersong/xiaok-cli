import { _electron } from '../../../desktop/node_modules/playwright/index.mjs';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if(!process.argv.includes('--live')){console.log('Use --live for isolated standard task UI verification.');process.exit(0);}
const root=resolve('desktop'),temp=await mkdtemp(join(tmpdir(),'xiaok-standard-ui-'));
// Interactive previews retain the user's configured models, while all writes
// and runtime ownership stay in this private, isolated directory.
if(process.argv.includes('--keep-open')) {
 const configRoot=join(temp,'config');await mkdir(configRoot,{recursive:true,mode:0o700});
 try {
  const current=await readFile(join(process.env.XIAOK_CONFIG_DIR??join(homedir(),'.xiaok'),'config.json'));
  await writeFile(join(configRoot,'config.json'),current,{mode:0o600,flag:'wx'});
 } catch(error) {if(error.code!=='ENOENT')throw error;}
}
const bootstrap=join(temp,'bootstrap.cjs');
await writeFile(bootstrap,`const { app } = require('electron');\napp.setPath('userData', ${JSON.stringify(join(temp,'userData'))});\nimport(${JSON.stringify(pathToFileURL(join(root,'dist/main/desktop/electron/main.js')).href)});\n`);
const env={...process.env,XIAOK_CONFIG_DIR:join(temp,'config')};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({args:[bootstrap],env,cwd:temp,timeout:60000});
const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
console.log(JSON.stringify({temp,pid:app.process().pid}));
try{
 await page.waitForLoadState('domcontentloaded');
 await page.getByRole('button',{name:'切换默认模型',exact:true}).click();
 await page.getByRole('button',{name:/本地 Codex/}).click();
 await page.locator('textarea').fill('[Standard task acceptance] No tools. Remember the marker STANDARD_UI_CODEX_READY and reply only with it.');
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await page.waitForURL(/#\/t\//,{timeout:30000});
 await page.getByText('STANDARD_UI_CODEX_READY',{exact:true}).waitFor({timeout:180000});
 await page.screenshot({path:join(temp,'standard-task.png')});
 if(await page.getByRole('button',{name:'Codex 原生会话',exact:true}).count())throw new Error('obsolete menu present');
 await page.locator('textarea').fill('No tools. What marker did I ask you to remember? Reply only with that marker.');
 await page.getByRole('button',{name:'发送',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('p')].filter(e=>e.textContent==='STANDARD_UI_CODEX_READY').length>=2,{timeout:180000});
 await page.reload();
 await page.getByText('STANDARD_UI_CODEX_READY',{exact:true}).last().waitFor({timeout:30000});
 const report={temp,url:page.url(),errors,standardReply:true,followupContext:true,reloadHistory:true};
 await writeFile(join(temp,'ui-status.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(errors.length)throw new Error('renderer errors');
 if(process.argv.includes('--keep-open')){console.log('PREVIEW_READY '+temp);await new Promise(()=>{});}
}finally{
 let timer;try{await Promise.race([app.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('shutdown timeout')),30000);})]);}
 finally{clearTimeout(timer);if(app.process().exitCode===null)app.process().kill('SIGTERM');}
}

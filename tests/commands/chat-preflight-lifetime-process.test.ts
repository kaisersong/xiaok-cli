import { expect, it } from 'vitest';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

it.each(['validation-without-policy','invalid-goal','invalid-policy'] as const)('actual CLI %s retires no signal owner because no durable bootstrap was admitted',async mode=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'cli-preflight-lifetime-'))),entry=join(root,'entry.mjs'),invalid=join(root,'invalid.json'),marker=join(root,'listeners.json');writeFileSync(invalid,'{invalid original document');
 const args=mode==='validation-without-policy'?['--validation-material',invalid]:mode==='invalid-goal'?['--goal-verification',invalid]:['--observation-policy',invalid];
 writeFileSync(entry,`import fs from 'node:fs';import {Command} from ${JSON.stringify(pathToFileURL(resolve('node_modules/commander/index.js')).href)};import {registerChatCommands} from ${JSON.stringify(pathToFileURL(resolve('src/commands/chat.ts')).href)};
 const signals=['SIGINT','SIGHUP','SIGTERM'],before=Object.fromEntries(signals.map(s=>[s,process.listeners(s)]));
 const capture=()=>fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify(Object.fromEntries(signals.map(s=>[s,process.listeners(s).filter(listener=>!before[s].includes(listener)).length]))));
 const originalExit=process.exit;process.exit=function(code){capture();return originalExit.call(this,code);};
 const program=new Command();registerChatCommands(program);await program.parseAsync(['node','actual-preflight','chat',...${JSON.stringify(args)}]);capture();`);
 const child=spawn(process.execPath,['--import',resolve('tests/support/profile-account-child.setup.mjs'),'--import',resolve('node_modules/tsx/dist/loader.mjs'),entry],{cwd:root,env:{...process.env,XIAOK_CONFIG_DIR:join(root,'config'),XIAOK_TEST_ACCOUNT_HOME:root,XIAOK_TEST_RUNTIME_HOME:root,XIAOK_DISABLE_GLOBAL_PLUGINS:'1'},stdio:['ignore','pipe','pipe']});let output='',exited=false;child.stdout.on('data',text=>output+=text);child.stderr.on('data',text=>output+=text);const ended=new Promise<number|null>(r=>child.once('exit',code=>{exited=true;r(code);}));const watchdog=setTimeout(()=>child.kill('SIGKILL'),20000);
 try{expect(await ended,output).toBe(mode==='validation-without-policy'?2:1);expect(JSON.parse(readFileSync(marker,'utf8'))).toEqual({SIGINT:0,SIGHUP:0,SIGTERM:0});}
 finally{clearTimeout(watchdog);if(!exited)child.kill('SIGKILL');await ended;rmSync(root,{recursive:true,force:true});}
},30000);

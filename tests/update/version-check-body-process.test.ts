import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

it.each([false, true])('original registry body deadline settles with stale cache=%s', async stale => {
  const root = mkdtempSync(join(tmpdir(), 'update-body-account-'));
  const script = join(root, 'entry.mjs'), result = join(root, 'result.json');
  writeFileSync(script, `
    import fs from 'node:fs';import http from 'node:http';import {homedir} from 'node:os';import {join} from 'node:path';
    if(homedir()!==${JSON.stringify(root)})throw Error('account isolation failed');
    const cache=join(homedir(),'.xiaok','.update-check.json');
    if(${stale}){fs.mkdirSync(join(homedir(),'.xiaok'));fs.writeFileSync(cache,JSON.stringify({latest:'2.0.0',checkedAt:1}));}
    const server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{"version":');});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const original=globalThis.fetch;let aborted=false,bodySettled=false;const started=Date.now();
    globalThis.fetch=async(url,init)=>{if(String(url)!=='https://registry.npmjs.org/xiaokcode/latest')throw Error('unexpected URL');
      init.signal.addEventListener('abort',()=>{aborted=true;},{once:true});
      const response=await original('http://127.0.0.1:'+server.address().port,init),json=response.json.bind(response);
      response.json=()=>json().finally(()=>{bodySettled=true;});return response;};
    const watchdog=setTimeout(()=>server.closeAllConnections(),6800);
    const {checkForUpdate}=await import(${JSON.stringify(pathToFileURL(resolve('src/update/version-check.ts')).href)});
    const value=await checkForUpdate('1.0.0');
    fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({value,aborted,bodySettled,elapsed:Date.now()-started,cache:fs.existsSync(cache)?JSON.parse(fs.readFileSync(cache,'utf8')):null}));
    clearTimeout(watchdog);server.closeAllConnections();await new Promise(r=>server.close(r));
  `);
  const child = spawn(process.execPath, ['--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href, script], { env: { ...process.env, HOME: root }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';child.stdout.on('data', chunk => output += chunk);child.stderr.on('data', chunk => output += chunk);
  const exit = new Promise<number|null>(r => child.once('exit', r));
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 14000);
  try {
    expect(await exit, output).toBe(0);
    const observed = JSON.parse(readFileSync(result, 'utf8'));
    expect(observed.aborted).toBe(true);
    expect(observed.bodySettled).toBe(true);
    expect(observed.elapsed).toBeGreaterThanOrEqual(4900);
    expect(observed.elapsed).toBeLessThan(6300);
    expect(observed.value).toEqual(stale ? { current: '1.0.0', latest: '2.0.0', hasUpdate: true } : null);
    expect(observed.cache).toEqual(stale ? { latest: '2.0.0', checkedAt: 1 } : null);
  } finally { clearTimeout(watchdog);if(child.exitCode===null)child.kill('SIGKILL');await exit;rmSync(root,{recursive:true,force:true}); }
}, 20000);
